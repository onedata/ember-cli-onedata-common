/**
 * A secondary sidebar for selecting Space to modify its permissions.
 * Uses internally spaces-submenu component to render select for
 * users/groups/providers permissions.
 *
 * Send actions:
 * - showSpaceOptions(space)
 * - showUsersConfig(space)
 * - showGroupsConfig(space)
 *
 * @module components/spaces-menu
 * @author Jakub Liput
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
*/

import Ember from 'ember';

export default Ember.Component.extend({
  service: Ember.inject.service('spaces-menu'),
  store: Ember.inject.service(),
  notify: Ember.inject.service(),
  oneproviderServer: Ember.inject.service(),
  commonModals: Ember.inject.service(),

  spaces: null,
  spacesSorting: ['isDefault:desc', 'name'],
  spacesSorted: Ember.computed.sort('spaces', 'spacesSorting'),

  activeSpace: Ember.computed.alias('service.activeSpace'),

  /*** Variables for actions and modals ***/

  isCreatingSpace: false,
  newSpaceName: null,

  isJoiningSpace: false,
  joinSpaceToken: null,

  spaceToRename: null,
  renameSpaceName: null,

  spaceToRemove: null,

  registerInService: function() {
    this.set('service.component', this);
  }.on('init'),

  clearService: function() {
    this.get('service').clear();
  }.on('willDestroyElement'),

  /** If activeSpace not set, choose default space if available */
  initActiveSpace: function() {
    if (!this.get('activeSpace')) {
      if (this.get('spaces.length') > 0) {
        let defaultSpace = this.get('spaces').find((s) => s.get('isDefault'));
        if (defaultSpace) {
          this.set('activeSpace', defaultSpace);
        }
      }
    }
  }.observes('spaces.length'),

  activeSpaceDidChange: function() {
    if (this.get('activeSpace')) {
      this.sendAction('showSpaceOptions', this.get('activeSpace'));
    }
  }.observes('activeSpace'),

  didInsertElement() {
    // reset spaces expanded state
    this.get('spaces').forEach((s) => s.set('isExpanded', false));
    this.initActiveSpace();
  },

  spaceActionMessage(notifyType, messageId, spaceName) {
    let message = this.get('i18n').t(`components.spacesMenu.notify.${messageId}`, {spaceName: spaceName});
    this.get('notify')[notifyType](message);
  },

  actions: {
    openSubmenuEntry(space, name) {
      this.sendAction('openSubmenuEntry', space, name);
    },

    startCreateSpace() {
      this.set('isCreatingSpace', true);
    },

    createSpaceModalOpened() {
      this.set('newSpaceName', null);
    },

    submitCreateSpace() {
      try {
        let s = this.get('store').createRecord('space', {
          name: this.get('newSpaceName')
        });
        s.save();
      } catch (error) {
        this.get('notify').error(`Creating space with name "${this.get('newSpaceName')}" failed`);
        console.error(`Space create failed: ${error}`);
      } finally {
        this.set('isCreatingSpace', false);
      }
    },

    startJoinSpace() {
      this.set('joinSpaceToken', null);
      this.set('isJoiningSpace', true);
    },

    submitJoinSpace() {
      try {
        let token = this.get('joinSpaceToken').trim();
        // TODO: loading gif in modal?
        this.get('oneproviderServer').joinSpace(token).then(
          (spaceName) => {
            this.spaceActionMessage('info', 'joinSuccess', spaceName);
          },
          (errorJson) => {
            console.log(errorJson.message);
            let message = this.get('i18n').t('components.spacesMenu.notify.joinFailed', {errorDetails: errorJson.message});
            this.get('notify')['error'](message);
            //this.spaceActionMessage('error', 'joinFailed', message);
          }
        );
      } finally {
        this.set('isJoiningSpace', false);
      }
    },

    /*** Single space operation modals ***/

    openSettingsModal(modalName, space) {
      this.set('modalSpace', space);
      this.set('openedModal', modalName);
    },

    setAsHome(space) {
      this.get('spaces').filter((s) => s.get('isDefault')).forEach((s) => {
        s.set('isDefault', false);
        s.save();
      });
      space.set('isDefault', true);
      // TODO: notify success
      space.save();
    },

    submitLeaveSpace() {
      try {
        let space = this.get('modalSpace');
        let spaceName = space.get('name');
        this.get('oneproviderServer').leaveSpace(space).then(
          () => {
            this.spaceActionMessage('info', 'leaveSuccess', spaceName);
          },
          () => {
            this.spaceActionMessage('error', 'leaveFailed', spaceName);
          }
        );
      } finally {
        this.set('modalSpace', null);
        this.set('openedModal', null);
      }
    },

    submitRenameSpace() {
      try {
        let space = this.get('modalSpace');
        space.set('name', this.get('renameSpaceName'));
        // TODO: save notification
        space.save();
      } finally {
        this.set('modalSpace', null);
        this.set('openedModal', null);
      }
    },

    submitRemoveSpace() {
      try {
        let space = this.get('modalSpace');
        let spaceName = space.get('name');
        space.destroyRecord().then(
          () => {
            this.spaceActionMessage('info', 'removeSuccess', spaceName);
          },
          () => {
            this.spaceActionMessage('error', 'removeFailed', spaceName);
          }
        );
      } finally {
        this.set('modalSpace', null);
        this.set('openedModal', null);
      }
    },
  }
});
