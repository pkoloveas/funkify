import { ChatManagerDelegate } from './chat-manager-delegate.js';
import _ from 'lodash';

export default class FunkifyChatDelegate extends ChatManagerDelegate {
  constructor (state) {
    super();
    this.state = state;
    
    this.state.messages = [];
    
    this.systemContextInput = document.querySelector('textarea#system-context');
    
    this.modelPicker = document.querySelector('select#model-picker');
    this.modelPicker.value = this.state.service.models[0];
    this.modelPicker.addEventListener('change', this.onModelSelect.bind(this));
    
    this.visionDetailPicker = document.querySelector('select#vision-detail');
    this.visionDetailPicker.value = "low";
  }
  
  onModelSelect (event) {
    if (this.isVisionModel) {
      this.visionDetailPicker.removeAttribute('disabled');
    } else {
      this.visionDetailPicker.setAttribute('disabled', true);
    }
  }
  
  get currentModel () {
    return this.modelPicker.value;
  }
  
  get visionDetail () {
    return this.visionDetailPicker.value;
  }
  
  get systemContext () {
    return this.systemContextInput.value;
  }
  
  get isVisionModel () {
    return this.service.modelSupportVision(this.currentModel);
  }
  
  get tools () {
    return _.map(this.state.tools, 'schema');
  }
  
  get functions () {
    return this.state.tools;
  }
  
  get systemMessage () {
    return {
      role: 'system',
      content: this.systemContext
    }
  }
  
  get messages () {
    const messagesHaveSystemContext = _.chain(this.state.messages).map('role').includes('system').value();
    if (!messagesHaveSystemContext) {
      this.state.messages.unshift(this.systemMessage);
    }
    
    return this.state.messages;
  }
  
  addMessage (message, elementId=null) {
    this.state.messages.push(message);
  }
  
  renderMessage (message, data=null) {
    return this.state.messagesManager.renderMessage(message, data);
  }
  
  updateMessageInList (id, content) {
    return this.state.messagesManager.updateMessageInList(id, content);
  }
  
  get supportsImages () {
    return true;
  }
  
  get stream () {
    return true;
  }
  
  initializeLLMService () {
    this.state.service.initialize();
  }
  
  async createTextCompletion (params) {
    return this.state.service.createTextCompletion(params);
  }
}
