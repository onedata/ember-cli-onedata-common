import Ember from 'ember';

/**
 * Single space Route - loads Space data before actions/resources for a single
 * space.
 * @module routes/spaces/show
 * @author Jakub Liput
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */
export default Ember.Route.extend({
  spacesMenuService: Ember.inject.service('spaces-menu'),

  model(params) {
    return this.store.find('space', params.space_id);
  },

  /** By default, open users settings */
  afterModel(/*space*/) {
    this.transitionTo('spaces.show.users');
  }
});
