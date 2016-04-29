import Ember from 'ember';

/**
 * Load a single dir (File model) and show a file browser for it (passed as route name).
 * @module routes/data/data-space/dir
 * @author Jakub Liput
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */
export default Ember.Route.extend({
  fileSystemTree: Ember.inject.service(),
  dataFilesTree: Ember.inject.service(),
  notify: Ember.inject.service(),

  model(params) {
    // TODO: check if loaded dir belongs to loaded space (data/data-space model)?
    return this.store.findRecord('file', params.dir_id);
  },

  afterModel(file/*, transition*/) {
    this.set('invalid', false);

    if (file.get('isDeleted')) {
      console.error('Loaded file is deleted');
      this.get('notify').error(`Cannot load dir because it is marked as deleted`);
      this.set('invalid', true);
    }

    if (!file.get('isDir')) {
      console.error('Loaded file is not a directory - it cannot be viewed in browser');
      this.get('notify').error(`Cannot load dir because it not a valid directory`);
      this.set('invalid', true);
    }

    // @todo this sometimes runs too early and getSpaceIdForFile does not work
    //let loadedDirSpaceId = this.get('fileSystemTree').getSpaceIdForFile(file);
    //if (loadedDirSpaceId !== this.modelFor('data.data-space').get('id')) {
    //  console.error('Space of loaded dir (file) is not a space loaded in data-space route');
    //  transition.abort();
    //}

    Ember.run.scheduleOnce('afterRender', this, function() {
      this.get('fileSystemTree').expandDir(file).then(() => {
        let elementId = `#tree-dir-${file.id}`;
        $('.dir-item.active').removeClass('active');
        $(elementId).addClass('active');
      });
    });
  },

  /**
    This is a directory browser. It can show only one directory contents at a time.
    Render it in "data" template, because it's a master view of a data browser.
  */
  renderTemplate() {
    if (!this.get('invalid')) {
      this.render('data.dataSpace.dir.dirToolbar', {
        into: 'application',
        outlet: 'toolbar'
      });
      this.render({
        into: 'data',
        outlet: 'dir'
      });
    } else {
      this.render('data.dataSpace.dir.error', {
        into: 'data',
        outlet: 'dir'
      });
    }
  }
});
