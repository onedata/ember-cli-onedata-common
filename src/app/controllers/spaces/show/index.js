import Ember from 'ember';

/**
 * Just go to default spaces submenu option then model is fully loaded.
 * @module controllers/spaces/show/index
 * @author Jakub Liput
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */
export default Ember.Controller.extend({
  defaultOption: 'users',

  goToDefaultOption() {
    if (this.get('model')) {
      this.transitionToRoute(`spaces.show.${this.defaultOption}`, this.get('model'));
    }
  },

  /**
    Observe for a space to appear in model.
    When ready - load a default "users permissions".
  */
  onModelChange: function() {
    this.goToDefaultOption();
  }.observes('model')
});
