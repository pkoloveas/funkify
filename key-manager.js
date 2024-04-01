import * as Interface from './interface.js';

export class KeyManager {
  constructor (state) {
    this.state = state;
    
    Interface.initializeTextInput('#openai-api-key', this.apiKeyHandler, this.defaultApiKeyGetter);
    // Note that initializeTextInput does not call the setter by default.
    
    state.apiKey = this.defaultApiKeyGetter();
    this.addToggleVisibilityButton();
  }
  
  addToggleVisibilityButton () {
    const togglePasswordVisibility = () => {
      const apiKeyInput = document.querySelector('input#openai-api-key');
      if (apiKeyInput.type === 'text') {
        apiKeyInput.type = 'password';
      } else {
        apiKeyInput.type = 'text';
      }
    };
    
    const toggleButton = document.querySelector('#toggle-openai-key-visibility');
    toggleButton.addEventListener('click', togglePasswordVisibility);
  }
  
  apiKeyHandler (value, event) {
    this.state.apiKey = value;
    this.state.openAIApiKeyChanged = true;
    localStorage.setItem('funkily-openai-api-key', this.state.apiKey);
  }
  
  defaultApiKeyGetter () {
    return localStorage.getItem('funkily-openai-api-key');
  }
}
