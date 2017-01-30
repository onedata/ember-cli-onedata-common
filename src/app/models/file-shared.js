/**
 * Represents a file in a share file browser for signed-in user.
 * @module models/file-shared
 * @author Łukasz Opioła
 * @author Jakub Liput
 * @copyright (C) 2016-2017 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */

import DS from 'ember-data';

import createFileModel from 'op-worker-gui/mixin-factories/models/file';

export default DS.Model.extend(createFileModel('shared'));
