import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

import * as Interface from './interface.js';
import * as Helpers from './helpers.js';

// General URL regex.
const urlRegex = /(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*/gi;
// Image url regex that also accounts for arbitrary URL parameters at the end.
const imageUrlRegex = /\bhttps?:\/\/\S+\.(jpg|jpeg|png|gif|svg)(\?\S*)?\b/gi;


export class ChatManager {
  constructor (state, delegate) {
    this.state = state;
    this.delegate = delegate;
    
    this.state.shouldLimitHistory = false;
    this.experimentalLimitedHistory = document.querySelector('#experiment-limited-history');
    Interface.initializeCheckbox('#experiment-limited-history', (checked, event) => {
      console.debug(`Experimental feature: limit chat history? ${checked}`);
      this.state.shouldLimitHistory = checked;
    });
  }
  
  get currentModel () {
    return this.delegate.currentModel;
  }
  
  get visionDetail () {
    return this.delegate.visionDetail;
  }
  
  get systemContext () {
    return this.delegate.systemContext;
  }
  
  get messages () {
    return this.delegate.messages;
  }
  
  get tools () {
    return this.delegate.tools;
  }
  
  get stream () {
    return this.delegate.stream;
  }
  
  get service () {
    return this.state.service;
  }
  
  addMessage (message, id) {
    this.delegate.addMessage(message, id);
  }
  
  renderMessage (message, data=null) {
    return this.delegate.renderMessage(message, data);
  }
  
  get isVisionModel () {
    return this.state.serviceManager.currentModelSupportsVision;
  }
  
  initializeLLMService () {
    this.delegate.initializeLLMService();
  }
  
  // Construct the parameters for the coming call to the LLM service.
  get params () {
    const tr = {
      model: this.currentModel,
      messages: this.messages,
      stream: this.stream,
    };
    
    // Gather up all the available tools, if any.
    // This is typically an array of tool schemas, e.g. { type: 'function', ... }
    if (!_.isEmpty(this.tools)) {
      tr.tools = this.tools;
    }
    
    return tr;
  }
  
  get supportsImages () {
    return this.delegate.supportsImages;
  }
  
  detectImageUrls (str) {
    return str.match(urlRegex);
  }
  
  removeImageUrls (str) {
    return _.trim(str.replace(urlRegex, ""));
  }
  
  // Submit a prompt as a string to the chat manager.
  // This is preferred as it performs some preprocessing to look for things like image URLs.
  async submitPrompt (userPrompt) {
    const message = {
      role: 'user',
      content: this.getUserMessageContent(userPrompt),
    };
    
    return await this.submitMessage(message);
  }
  
  // Returns the proper "content" field for a user's message.
  // This sanitizes the input (according to the delegate implementation) and takes 
  // into account image URLs.
  getUserMessageContent (prompt) {
    const sanitizedPrompt = this.delegate.sanitizeUserPrompt(prompt);
    
    if (!this.supportsImages || !this.isVisionModel) { return sanitizedPrompt; }
    
    const imageUrls = this.detectImageUrls(sanitizedPrompt);
    const hasImageUrls = !_.isEmpty(imageUrls);
    if (!hasImageUrls) { return sanitizedPrompt; }
    
    console.debug('Detected urls:', imageUrls);
    
    // Create the return value.
    const content = [
      { type: "text", text: sanitizedPrompt }
    ];
    
    // For each image URL, add a part to the content.
    // https://platform.openai.com/docs/guides/vision
    imageUrls.forEach(url => {
      const part = {
        type: "image_url",
        image_url: {
          url: url,
          detail: this.visionDetail,
        }
      };
      
      content.push(part);
    });
    
    return content;
  }
  
  // Submit a fully qualified message object to the chat manager.
  // For OpenAI, these are typically in the form of: { role: 'user', content: '' }
  async submitMessage (userMessage) {
    this.initializeLLMService();
    
    // Display the model and other parameters we're using for this chat.
    if (userMessage) {
      this.showModelAndParameters();
    }
    
    // Creates an HTML element to receive the streaming tokens, if any.
    let messageElementId = this.prepareInitialMessageElement(userMessage);
    
    const completion = await this.prepareCompletionInstance(this.params);
    if (!completion) { return; }
    
    const responseMessage = await this.processCompletion(completion, messageElementId);
    
    this.delegate.processAssistantMessage(responseMessage);
    
    this.addMessage(responseMessage);
    
    const isToolCallsMessage = !_.isEmpty(responseMessage.tool_calls);
    if (!isToolCallsMessage) { return; }
    
    this.delegate.processToolCallsMessage(responseMessage);
    
    // Calls all the functions needed to ensure we have the info for the final completion.
    const functionResponseMessages = await this.processToolCalls(responseMessage);
    for (const functionResponseMessage of functionResponseMessages) {
      this.addMessage(functionResponseMessage);
    }
    
    // TODO: Handle this recursively for now. Put this in a loop or a queue instead?
    await this.submitMessage(null);
  } // end submitMessage
  
  prepareInitialMessageElement (userMessage) {
    if (userMessage) {
      this.renderMessage(userMessage);
      this.addMessage(userMessage);
    }
    
    // TODO: Add an assistant message-item after every submitted message?
    // This is needed after user → assistant and tool → assistant, but not user → tool.
    const pseudoMessage = {
      role: 'assistant',
      content: null
    };
    
    const assistantElt = this.renderMessage(pseudoMessage);
    return assistantElt.id;
  }
  
  showModelAndParameters () {
    const pseudoMessage = {
      role: 'meta',
      content: `Model: ${this.delegate.currentModel}`
    };
    
    this.renderMessage(pseudoMessage);
  }
  
  async prepareCompletionInstance (params) {
    try {
      // Submit the completion request to the LLM service.
      return await this.delegate.createTextCompletion(params);
    } catch (err) {
      const errorMessage = {
        role: 'assistant',
        content: `An error occurred. ${err.name}. ${err.message}`,
      };
      
      this.renderMessage(errorMessage);
      
      console.error(`An error occurred while creating the completion object:`, err);
      return null;
    }
  }
  
  async processCompletion (completion, targetElementId) {
    if (!this.stream) {
      return this.processNonStreamingCompletion(completion, targetElementId);
    } else {
      return await this.processStreamingCompletion(completion, targetElementId);
    }
  }
  
  processNonStreamingCompletion (completion, messageElementId) {
    const responseMessage = completion.choices[0].message;
    
    if (_.isEmpty(responseMessage.tool_calls)) {
      this.delegate.updateMessageInList(messageElementId, responseMessage.content);
    }
    
    return responseMessage;
  }
  
  async processStreamingCompletion (completion, messageElementId) {
    const message = {};
    
    const setTopLevel = (message, delta, key, once=false) => {
      if (_.has(delta, key) && !_.has(message, key)) {
        // If the message doesn't have the key, set the initial value.
        // E.g. This also takes care of cases in which the desired value is null.
        message[key] = delta[key];
      } else if (_.isString(delta[key])) {
        // For strings, concat them to the current value.
        if (!_.isString(message[key])) {
          // Maybe we had an undefined or null value before, so reset it.
          message[key] = delta[key];
        } else if (!once) {
          message[key] += delta[key];
        }
      }
    };
    
    // Process the streaming, if streaming was indicated.
    for await (const chunk of completion) {
      const choice = chunk.choices[0];
      
      if (choice.finish_reason === "tool_calls") { break; }
      
      // When streaming, there is a "delta" object instead of a "message" object.
      const delta = choice.delta;
      
      // Any expected top-level keys in delta should be copied or appended.
      setTopLevel(message, delta, 'name');
      setTopLevel(message, delta, 'role', true);
      setTopLevel(message, delta, 'refusal');
      setTopLevel(message, delta, 'content');

      // We can cue tool_calls from the 'delta' field.
      if (_.isArray(delta.tool_calls)) {
        if (!_.isArray(message.tool_calls)) {
          message.tool_calls = [];
        }
        
        // delta.tool_calls will be an array that has also chunks we need to combine.
        for (const tool_call of delta.tool_calls) {
          const index = tool_call.index;
          
          // Populate the target tool_call object.
          if (_.isEmpty(message.tool_calls[index])) {
            message.tool_calls[index] = {
              type: "function",
              function: {
                name: '',
                arguments: '',
              },
              id: '',
            };
          }
          
          // Populate the tool_call fields based on what we have in this current chunk.
          
          if (!_.isEmpty(tool_call.id)) {
            // Tool call IDs don't seem to be chunked, so I think we can just set it if empty.
            message.tool_calls[index].id = tool_call.id;
          }
          
          if (!_.isEmpty(tool_call.function.name)) {
            message.tool_calls[index].function.name += tool_call.function.name;
          }
          
          if (!_.isEmpty(tool_call.function.arguments)) {
            message.tool_calls[index].function.arguments += tool_call.function.arguments;
          }
        }
      }
      
      if (_.isString(delta.content)) {
        // If we have an update to the content field, then we should render it.
        const elt = this.delegate.updateMessageInList(messageElementId, message.content);
        if (elt.id !== messageElementId) {
          // This shouldn't happen, but if it does, let's ensure we have a real element.
          console.warn(`Attempted to find element id = ${messageElementId} but didn't find it. Creating a new one with ${elt.id}`);
          messageElementId = elt.id;
        }
      }
    } // end chunk completion loop
    
    return message;
  }
  
  async processToolCalls (message) {
    const tr = [];
    for await (const tool_call of message.tool_calls) {
      const functionResponseMessage = await this.processToolCall(tool_call);
      tr.push(functionResponseMessage);
    }
    return tr;
  }
  
  async processToolCall (tool_call) {
    const function_name = tool_call.function.name;
    
    let function_args
    try {
      if (_.isString(tool_call.function.arguments)) {
        function_args = JSON.parse(tool_call.function.arguments);
      } else if (_.isObject(tool_call.function.arguments)) {
        function_args = tool_call.function.arguments;
      }
    } catch (err) {
      console.error(err, tool_call.function.arguments);
    }
    
    const function_to_call = _.find(this.delegate.functions, t => t.name === function_name);
    
    // Package the result of the function call as a message object.
    const functionResponseMessage = {
      tool_call_id: tool_call.id,
      role: 'tool', // required
      name: function_name,
    };
    
    let functionElement = null;
    
    let function_result
    if (!function_to_call) {
      console.error(`Function call ${function_name} not found. Returning null.`)
      function_result = null;
    } else {
      console.debug(`Calling function ${function_name} with arguments:`, function_args);
      
      // Add the message to the list in case we want to indicate the function call.
      // The delegate can ignore these.
      functionElement = this.renderMessage(functionResponseMessage, function_args);
      
      // Perform the function call.
      try {
        function_result = await function_to_call.call(function_args, this.state);
      } catch (err) {
        function_result = `Something went wrong with the tool call ${function_name}: ${err.message}`;
        console.error(function_result);
      }
    }
    
    functionResponseMessage.content = Helpers.stringify(function_result);
    
    if (functionElement) {
      this.delegate.updateMessageInList(functionElement.id, functionResponseMessage.content);
    }
    
    return functionResponseMessage;
  }
}
