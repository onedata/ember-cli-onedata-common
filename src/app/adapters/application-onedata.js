// jshint esnext: true

/**
 * Custom adapter that handles model synchronization between client and server
 * using a websocket connection.
 * @module adapters/application
 * @author Łukasz Opioła
 * @copyright (C) 2016 ACK CYFRONET AGH
 * @license This software is released under the MIT license cited in 'LICENSE.txt'.
 */

// This file should be linked to app/adapters/application.js

import Ember from 'ember';
import DS from 'ember-data';

/** -------------------------------------------------------------------
 * Interface between client and server
 * Corresponding interface is located in gui_ws_handler.erl.
 * ------------------------------------------------------------------- */
// Path where WS server is hosted
let WS_ENDPOINT = '/ws/';
// Flush timeout of batch requests - they are accumulated and if no new request
// from ember store comes within this time, the batch is sent to the server.
// Expressed in milliseconds.
let FLUSH_TIMEOUT = 2000;

// All out-coming JSONs have the following structure (opt = optional field)
// {
//   uuid
//   msgType
//   resourceType
//   operation
//   resourceIds (opt)
//   data (opt)
// }
// All in-coming JSONs have the following structure (opt = optional field)
// {
//   uuid (opt, not used in push messages)
//   msgType
//   result
//   data (opt)
// }

// Message types, identified by `msgType` key
let TYPE_MODEL_REQ = 'modelReq';
let TYPE_MODEL_RESP = 'modelResp';
let TYPE_MODEL_CRT_PUSH = 'modelPushCreated';
let TYPE_MODEL_UPT_PUSH = 'modelPushUpdated';
let TYPE_MODEL_DLT_PUSH = 'modelPushDeleted';
let TYPE_RPC_REQ = 'RPCReq';
let TYPE_RPC_RESP = 'RPCResp';
// Operations on model, identified by `operation` key
let OP_FIND = 'find';
let OP_FIND_ALL = 'findAll';
let OP_FIND_QUERY = 'findQuery';
let OP_FIND_MANY = 'findMany';
let OP_FIND_HAS_MANY = 'findHasMany';
let OP_FIND_BELONGS_TO = 'findBelongsTo';
let OP_CREATE_RECORD = 'createRecord';
let OP_UPDATE_RECORD = 'updateRecord';
let OP_DELETE_RECORD = 'deleteRecord';
// Operation results, identified by `result` key
let RESULT_OK = 'ok';
let RESULT_ERROR = 'error';

export default DS.RESTAdapter.extend({
  store: Ember.inject.service('store'),

  initialized: false,
  onOpenCallback: null,
  onErrorCallback: null,

  // Promises that will be resolved when response comes
  promises: new Map(),
  // The WebSocket
  socket: null,
  // Queue of messages. They are accumulated if requests from store come
  // frequently and flushed after FLUSH_TIMEOUT.
  messageBuffer: [],

  /** -------------------------------------------------------------------
   * WebSocket initialization
   * ------------------------------------------------------------------- */

  /** Called automatically on adapter init. */
  init() {
    this.initWebSocket();
  },

  /** Initializes the WebSocket */
  initWebSocket(onOpen, onError) {
    // Register callbacks even if WebSocket is already being initialized.
    if (onOpen) {
      this.set('onOpenCallback', onOpen);
    }
    if (onError) {
      this.set('onErrorCallback', onError);
    }
    if (this.get('initialized') === false) {
      this.set('initialized', true);
      let adapter = this;

      let protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      let host = window.location.hostname;
      let port = window.location.port;

      let url = protocol + host + (port === '' ? '' : ':' + port) + WS_ENDPOINT;
      console.log('Connecting: ' + url);

      if (adapter.socket === null) {
        adapter.socket = new WebSocket(url);
        adapter.socket.onopen = function (event) {
          adapter.open.apply(adapter, [event]);
        };
        adapter.socket.onmessage = function (event) {
          adapter.receive.apply(adapter, [event]);
        };
        adapter.socket.onerror = function (event) {
          adapter.error.apply(adapter, [event]);
        };
      }
    }
  },

  /** -------------------------------------------------------------------
   * Adapter API
   * ------------------------------------------------------------------- */

  /** This method is used by the store to determine if the store should reload
   * all records from the adapter when records are requested by store.findAll.
   * */
  shouldReloadAll() {
    return false;
  },

  /** This method is used by the store to determine if the store should reload
   * a record after the store.findRecord method resolves a cached record. */
  shouldBackgroundReloadRecord() {
    return false;
  },

  /** Developer function - for logging/debugging */
  logToConsole(fun_name, fun_params) {
    console.log(fun_name + '(');
    if (fun_params) {
      for (let i = 0; i < fun_params.length; i++) {
        console.log('    ' + String(fun_params[i]));
      }
    }
    console.log(')');
  },

  /** Called when ember store wants to find a record */
  findRecord(store, type, id, record) {
    this.logToConsole(OP_FIND, [store, type, id, record]);
    return this.asyncRequest(OP_FIND, type.modelName, id);
  },

  /** Called when ember store wants to find all records of a type */
  findAll(store, type, sinceToken) {
    this.logToConsole(OP_FIND_ALL, [store, type, sinceToken]);
    return this.asyncRequest(OP_FIND_ALL, type.modelName, null, sinceToken);
  },

  /** Called when ember store wants to find all records that match a query */
  findQuery(store, type, query) {
    this.logToConsole(OP_FIND_QUERY, [store, type, query]);
    return this.asyncRequest(OP_FIND_QUERY, type.modelName, null, query);
  },

  /** Called when ember store wants to find multiple records by id */
  findMany(store, type, ids, records) {
    this.logToConsole(OP_FIND_MANY, [store, type, ids, records]);
    return this.asyncRequest(OP_FIND_MANY, type.modelName, null, ids);
  },

  /** @todo is this needed? **/
  findHasMany(store, record, url, relationship) {
    this.logToConsole(OP_FIND_HAS_MANY, [store, record, url, relationship]);
    return 'not_implemented';
  },

  /** @todo is this needed? */
  findBelongsTo(store, record, url, relationship) {
    this.logToConsole(OP_FIND_BELONGS_TO, [store, record, url, relationship]);
    return 'not_implemented';
  },

  /** Called when ember store wants to create a record */
  createRecord(store, type, record) {
    this.logToConsole(OP_CREATE_RECORD, [store, type, record]);
    let data = {};
    let serializer = store.serializerFor(type.modelName);
    serializer.serializeIntoHash(data, type, record, {includeId: true});
    return this.asyncRequest(OP_CREATE_RECORD, type.modelName, null, data);
  },

  /** Called when ember store wants to update a record */
  updateRecord(store, type, record) {
    this.logToConsole(OP_UPDATE_RECORD, [store, type, record]);
    let id = Ember.get(record, 'id');
    let changedAttributes = record.changedAttributes();
    let keys = Object.keys(changedAttributes);
    let changesData = {};
    keys.forEach((key) => {
      // changedAttributes hold a map with key of record field names and
      // values of two-element array [oldValue, newValue]
      changesData[key] = changedAttributes[key][1];
    });
    return this.asyncRequest(OP_UPDATE_RECORD, type.modelName, id, changesData);
  },

  /** Called when ember store wants to delete a record */
  deleteRecord(store, type, record) {
    this.logToConsole(OP_DELETE_RECORD, [store, type, record]);
    let id = Ember.get(record, 'id');
    return this.asyncRequest(OP_DELETE_RECORD, type.modelName, id);
  },

  /** @todo is this needed? */
  groupRecordsForFindMany(store, records) {
    this.logToConsole('groupRecordsForFindMany', [store, records]);
    return [records];
  },

  /** -------------------------------------------------------------------
   * RPC API
   * ------------------------------------------------------------------- */

  /**
   * Calls back to the server. Useful for getting information like
   * user name etc. from the server or performing some operations that
   * are not model-based.
   * @param {string} type - identifier of resource, e.g. 'public' for public RPC
   * @param {string} operation - function identifier
   * @param {object} data - json data
   */
  RPC(type, operation, data) {
    this.logToConsole('RPC', [type, operation, JSON.stringify(data)]);
    let payload = {
      msgType: TYPE_RPC_REQ,
      resourceType: type,
      operation: operation,
      data: data
    };
    return this.sendAndRegisterPromise(operation, type, payload);
  },

  /** -------------------------------------------------------------------
   * Internal functions
   * ------------------------------------------------------------------- */

  /**
   * Performs an sync request to server side and stores a handle to the
   * promise, which will be resolved in receive function.
   */
  asyncRequest(operation, type, ids, data) {
    this.logToConsole('asyncRequest', [operation, type, ids, JSON.stringify(data)]);
    if (!ids) {
      ids = null;
    }
    if (!data) {
      data = null;
    }
    let payload = {
      msgType: TYPE_MODEL_REQ,
      resourceType: type,
      operation: operation,
      resourceIds: ids,
      data: this.transformRequest(data, type, operation)
    };
    return this.sendAndRegisterPromise(operation, type, payload);
  },

  /**
   * Sends a payload (JSON) via WebSocket, previously adding a randomly
   * generated UUID to it and registers a promise
   * (which can later be retrieved by the UUID).
   */
  sendAndRegisterPromise(operation, type, payload) {
    // Add UUID to payload so we can later connect the response with a promise
    // (the server will include this uuid in the response)
    let uuid = this.generateUuid();
    payload.uuid = uuid;
    let adapter = this;
    return new Ember.RSVP.Promise(function (resolve, reject) {
      let success = function (json) {
        Ember.run(null, resolve, json);
      };
      let error = function (json) {
        Ember.run(null, reject, json);
      };
      adapter.promises.set(uuid, {
        success: success,
        error: error,
        type: type,
        operation: operation
      });
      console.log('registerPromise: ' + JSON.stringify(payload));
      adapter.send(payload);
    });
  },

  /** Generates a random uuid */
  generateUuid() {
    let date = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
      function (character) {
        let random = (date + Math.random() * 16) % 16 | 0;
        date = Math.floor(date / 16);
        return (character === 'x' ? random : (random & 0x7 | 0x8)).toString(16);
      });
  },

  /**
   * Used to transform some types of requests, because they carry different
   * information than Ember assumes.
   */
  transformRequest(json, type, operation) {
    switch (operation) {
      case OP_CREATE_RECORD:
        return json[type];

      case OP_FIND_QUERY:
        // In case of find_query, json is in form
        // {filter: {key: value}}
        // Just send the filter
        return json.filter;

      default:
        return json;
    }
  },

  /**
   * Transform response received from WebSocket to the format expected
   * by Ember.
   */
  transformResponse(json, type, operation) {
    let result = {};
    switch (operation) {
      case OP_FIND:
        result[type] = json;
        return result;

      case OP_FIND_ALL:
        result[type] = json;
        return result;

      case OP_FIND_QUERY:
        result[type] = json;
        return result;

      case OP_FIND_MANY:
        result[type] = json;
        return result;

      case OP_CREATE_RECORD:
        result[type] = json;
        return result;

      default:
        return json;
    }
  },

  /** WebSocket onopen callback */
  open() {
    let onOpen = this.get('onOpenCallback');
    if (onOpen) {
      onOpen();
    }
    // Flush messages waiting for connection open
    this.flushMessageBuffer();
  },

  /** Used to send a message (JSON) through WebSocket.  */
  send(payload) {
    this.messageBuffer.push(payload);
    this.flushMessageBuffer();
  },

  /** Flushes a whole batch of messages that has been accumulated. Makes sure
   * that at least FLUSH_TIMEOUT has passed since last batch update.
   * If the WS is not established yet, it will wait in the buffer until
   * the connection is on. */
  flushMessageBuffer() {
    let adapter = this;
    if (this.socket.readyState === 1) {
      if (adapter.messageBuffer.length > 0) {
        let batch = {batch: []};
        adapter.messageBuffer.forEach(function (payload) {
          batch.batch.push(payload);
        });
        adapter.messageBuffer = [];
        console.log('batch: ' + JSON.stringify(batch));
        adapter.socket.send(JSON.stringify(batch));
      }
    }
  },

  /** WebSocket onmessage callback, resolves promises with received replies. */
  receive(event) {
    let json = JSON.parse(event.data);
    if (json.batch) {
      for (let message of json.batch) {
        this.processMessage(message);
      }
    } else {
      console.log('Warning: dropping message: ' + JSON.stringify(json));
    }
  },

  processMessage(message) {
    let adapter = this;
    let promise;
    console.log('received: ' + JSON.stringify(message.data));
    if (message.msgType === TYPE_MODEL_RESP) {
      // Received a response to data fetch
      promise = adapter.promises.get(message.uuid);
      if (message.result === RESULT_OK) {
        let transformed_data = adapter.transformResponse(message.data,
          promise.type, promise.operation);
        console.log('FETCH_RESP success: ' + JSON.stringify(transformed_data));

        promise.success(transformed_data);
      } else if (message.result === RESULT_ERROR) {
        console.log('FETCH_RESP error: ' + JSON.stringify(message.data));
        promise.error(message.data);
      } else {
        console.log('Unknown operation result: ' + message.result);
      }
    } else if (message.msgType === TYPE_RPC_RESP) {
      // Received a response to RPC call
      promise = adapter.promises.get(message.uuid);
      if (message.result === RESULT_OK) {
        console.log('RPC_RESP success: ' + JSON.stringify(message.data));
        promise.success(message.data);
      } else if (message.result === RESULT_ERROR) {
        console.log('RPC_RESP error: ' + JSON.stringify(message.data));
        promise.error(message.data);
      } else {
        console.log('Unknown operation result: ' + message.result);
      }
    }
    else if (message.msgType === TYPE_MODEL_CRT_PUSH ||
      message.msgType === TYPE_MODEL_UPT_PUSH) {
      // Received a push message that something was created
      console.log(message.msgType + ': ' + JSON.stringify(message));
      let payload = {};
      payload[message.resourceType] = message.data;
      this.get('store').pushPayload(payload);
    } else if (message.msgType === TYPE_MODEL_DLT_PUSH) {
      let store = this.get('store');
      // Received a push message that something was deleted
      console.log('Delete:' + JSON.stringify(message));
      // data field contains a list of ids to delete
      message.data.forEach(function (id) {
        store.findRecord(message.resourceType, id).then(
          function (record) {
            store.unloadRecord(record);
          });
      });
    }
    if (message.uuid) {
      adapter.promises.delete(message.uuid);
    }
  },

  /** WebSocket onerror callback */
  error(event) {
    // TODO @todo better error handling, maybe reconnection attempts?
    console.error(`WebSocket connection error, event data: ` + event.data);

    let onError = this.get('onErrorCallback');
    if (onError) {
      onError();
    }
  }
});
