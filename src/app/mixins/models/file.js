import Ember from 'ember';

import DS from 'ember-data';
import octalPermissionsToString from 'op-worker-gui/utils/octal-permissions-to-string';
/* globals moment */

/**
 * Common attributes and methods of file and file-public models.
 * @module
 * @author Jakub Liput
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */
export default Ember.Mixin.create({
  errorNotifier: Ember.inject.service('errorNotifier'),
  notify: Ember.inject.service('notify'),
  oneproviderServer: Ember.inject.service(),

  name: DS.attr('string'),
  /**
    Specifies is this object a regular file ("file") or directory ("dir")
    To check if it is a dir please use "isDir" property.
  */
  type: DS.attr('string'),

  modificationTime: DS.attr('number'),
  size: DS.attr('number'),

  /**
   * How many children this directory (it it is a directory-type) has.
   * If ``totalChildrenCount`` is more than actual ``children.length``, it means
   * that more children can be fetch from server.
   *
   * See also: ``oneproviderServer.fetchMoreDirChildren``.
   *
   * See also: ``allChildrenLoaded`` computed property.
   */
  totalChildrenCount: DS.attr('number'),

  /// Runtime fields used to store state of file in application
  isExpanded: false,
  isSelected: false,
  isEditingMetadata: false,
  isNewlyCreated: false,

  /** @abstract */
  share: undefined,

  /** @abstract */
  parent: undefined,

  /** @abstract */
  children: undefined,

  /// properties for checking presence of object in relation without relation resolve
  /// note that share and parent relations should be present in classes

  hasShare: Ember.computed('share.content', function() {
    return this.belongsTo('share').id() != null;
  }),
  hasParent: Ember.computed('parent.content', function() {
    return this.belongsTo('parent').id() != null;
  }),
  hasFileProperty: Ember.computed.reads('hasMetadata'),
  hasMetadata: Ember.computed('fileProperty.content', function() {
    return this.belongsTo('fileProperty').id() != null || !!this.get('fileProperty.content');
  }),

  /**
   * Return true if this file is a dir and not all chilren are loaded from backend.
   * If this is not a dir, return undefined.
   */
  allChildrenLoaded: Ember.computed('totalChildrenCount', 'children.length', 'isDir', function() {
    if (this.get('isDir')) {
      return this.get('totalChildrenCount') <= this.get('children.length');
    }
  }),

  init() {
    this._super(...arguments);
    this.set('dirsPath', []);
  },

  sizeHumanReadable: function() {
    let bytes = this.get('size');
    if (!bytes && bytes !== 0) {
      return '';
    }

    let number = bytes;
    let unit = 'B';
    if (bytes > 1073741824) {
      unit = 'GB';
      number = bytes/1073741824;
    } else if (bytes >= 1048576) {
      unit = 'MB';
      number = bytes/1048576;
    } else if (bytes >= 1024) {
      unit = 'KB';
      number = bytes/1024;
    }
    return `${Math.round(number * 100) / 100} ${unit}`;
  }.property('size'),

  modificationMoment: function() {
    let timestamp = this.get('modificationTime');
    return timestamp ? moment(timestamp * 1000).format('YYYY-MM-DD HH:MM') : '-';
  }.property('modificationTime'),

  permissionsHumanReadable: function() {
    let perms = this.get('permissions');
    return perms ? octalPermissionsToString(perms) : '';
  }.property('permissions'),

  isDir: function () {
    return this.get('type') === 'dir';
  }.property('type'),

  isBroken: function () {
    return this.get('type') === 'broken';
  }.property('type'),

  resetBrowserState() {
    this.set('isExpanded', false);
    this.set('isSelected', false);
  },

  resetBrowserStateRecursive() {
    this.get('children').forEach((child) => child.resetBrowserStateRecursive());
    this.resetBrowserState();
  },

  /**
   * Delete share when file delete succeeded
   */
  destroyRecord() {
    const sharePromise = this.get('share');
    const destroyPromise = this._super(...arguments);
    destroyPromise.then(() => {
      if (sharePromise) {
        sharePromise.then(s => {
          if (s) {
            s.deleteRecord();
          }
        });
      }
    });
    return destroyPromise;
  },

  /**
  * First, destroys this file.
  * If it succeeds, delete (local cache) recursively all children.
  * 
  * @returns {RSVP.Promise} a promise from this file ``destroyRecord``
  */
  destroyRecursive() {
    let children = this.get('children');
    let file = this;
    let deleteChildren = function() {
      if (children) {
        children.forEach((child) => {
          child.deleteRecursive();
        });
      } else {
        console.debug('After destroy of ' + file.get('id') + ' there are no children');
      }
    };

    let destroyPromise = this.destroyRecord();
    destroyPromise.then(deleteChildren);
    destroyPromise.catch(() => file.rollbackAttributes());

    return destroyPromise;
  },

  deleteRecursive() {
    console.debug('Will delete recursive: ' + this.get('id'));
    let children = this.get('children');
    console.debug('Children to delete: ' + children.map((c) => c.get('i')));
    if (children && children.get('length') > 0) {
      children.forEach((child) => {
        child.deleteRecursive();
      });
    }
    console.debug('Deleting file: ' + this.get('id'));
    // remove self from parent children list - issues here TODO!
    // TODO: perfomance issues on big trees?
    let parent = this.get('parent');
    let parentChildren = parent.get('children');
    if (parent && parentChildren) {
      parent.set('children',
        parentChildren.filter((child) => child.get('id') !== this.get('id'))
      );
      this.set('parent', null);
    }
    this.deleteRecord();
    console.debug('File: ' + this.get('id') + ' isDeleted: ' + this.get('isDeleted'));
  },

  isVisible: function () {
    var visible = this.get('parent.isExpanded');
    console.log('deselect(' + this.get('name') + '): ' +
      (this.get('isSelected') && !visible));
    if (this.get('isSelected') && !visible) {
      this.set('isSelected', false);
    }
    return visible;
  }.property('parent.isExpanded'),

  /// Utils

  /**
   * Resolves an array with file parents, including the file.
   * The array is ordered from root dir to given file (from parents to children).
   *
   * @param file - a leaf file of path to find
   * @returns {RSVP.Promise} resolves with array of Files
   */
  resolveDirsPath() {
    let path = [this];
    return new Ember.RSVP.Promise((resolve, reject) => {
      this.get('parent').then(
        (p) => {
          if (p) {
            p.resolveDirsPath().then((ppath) => {
              resolve(ppath.concat(path));
            });
          } else {
            resolve(path);
          }
        },

        () => {
          reject();
        }
      );
    });
  },

  updateDirsPath: Ember.on('init', Ember.observer('parent', 'parent.name', function() {
    this.resolveDirsPath().then(data => this.set('dirsPath', data));
  })),

  path: Ember.computed('dirsPath.@each.name', function() {
    const dp = this.get('dirsPath');
    return dp && dp.mapBy('name').join('/');
  }),

  // TODO: move directory utils to mixin
  /// Directory utils

  hasSubDirs: Ember.computed('children.@each.isDir', function() {
    if (this.get('isDir')) {
      return this.get('children').some(c => c.get('isDir'));
  } else {
      return false;
    }
  }),

  selectedFiles: Ember.computed('isDir', 'children.@each.isSelected', function() {
    if (this.get('isDir')) {
      return this.get('children').filterBy('isSelected');
    } else {
      return null;
    }
  }),

  selectedFilesType: Ember.computed('selectedFiles.@each.type', function() {
    const sf = this.get('selectedFiles');
    let firstType = sf.length > 0 ? sf[0].get('type') : undefined;
    if (sf.length > 0 && sf.every(f => f.get('type') === firstType)) {
      return firstType;
    } else {
      return 'mixed';
    }
  }),

  singleSelectedFile: Ember.computed('isDir', 'selectedFiles.[]', 'selectedFiles.firstObject',
    function() {
      if (this.get('isDir')) {
        let selected = this.get('selectedFiles');
        return selected.length === 1 ? selected.get('firstObject') : null;
      } else {
        return null;
      }
    }
  ),

  isSomeFileSelected: Ember.computed('isDir', 'selectedFiles.[]', function() {
    if (this.get('isDir')) {
      return this.get('selectedFiles.length') > 0;
    } else {
      return false;
    }
  }),

  /**
   * If this file is a dir, remove its selected files.
   * @returns {Map<RSVP.Promise>|String} Map: file -> destroy promise
   *                                     or String with error (if whole procedure fails)  
   */
  removeSelectedFiles() {
    // file -> destroy promise
    let fileDestroyPromises = new Map();
    if (this.get('isDir')) {
      this.get('selectedFiles').forEach(file => {
        fileDestroyPromises.set(file, file.destroyRecursive());
      });
    } else {
      console.error(`Called removeSelectedFiles on file that is not a directory ${this.get('id')}`);
      return 'Parent of files to remove is not a directory';
    }
    return fileDestroyPromises;
  },

  setSelectedFilesPermissions(permissions) {
    this.get('selectedFiles').forEach((file) => {
      file.set('permissions', parseInt(permissions));
      // TODO: handle errors
      file.save().then(() => {}, (failMessage) => {
        this.get('errorNotifier').handle(failMessage);
        file.rollback();
      });
    });
  },

  /**
    Creates file in this directory (only if this.get('isDir'))
    @param {String} type Type of file-object: 'file' or 'dir'
    @param {String} fileName
    @returns {RVSP.Promise} Promise that resolves with created file on save success
      and rejects with error on error:
      - resolve(file)
      - reject(error)
  */
  createFile(type, fileName) {
    if (!this.get('isDir')) {
      console.error(`Called createFile on file that is not a directory: ${this.get('id')}`);
    }

    const parentId = this.get('id');

    return new Ember.RSVP.Promise((resolve, reject) => {
      function handleFileCreationError(error) {
        try {
          console.error(
`File with name "${fileName}" creation failed: ${JSON.stringify(error)};
File parent id: ${parentId}`
          );
        } finally {
          reject(error.message || error);
        }
      }

      const savePromise = this.get('oneproviderServer').createFile(fileName, parentId, type);
      savePromise.then(
        (data) => {
          console.debug(`File created with ID: ${data.fileId}`);
          resolve();
        },
        (error) => handleFileCreationError(error)
      );
    });
  }
});
