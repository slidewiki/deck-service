'use strict';

//require
var Ajv = require('ajv');
var ajv = Ajv({
  verbose: true,
  allErrors: true
    //v5: true  //enable v5 proposal of JSON-schema standard
}); // options can be passed, e.g. {allErrors: true}

//build schema
const objectid = {
  type: 'string',
  maxLength: 24,
  minLength: 24
};

//build schema
const contentItem = {
  type: 'object',
  properties: {
    order: {
      type: 'string'
    },
    kind: {
      type: 'string',
      enum: ['deck', 'slide']
    },
    ref: {
      type: 'object',
      properties: {
        id: objectid,
        revision: {
          type: 'number',
          minimum: 1
        } //if not given use the last revision
      },
      required: ['id']
    }
  },
  required: ['kind', 'ref']
};
const deckRevision = {
  type: 'object',
  properties: {
    id: { //increment with every new revision
      type: 'number',
      minimum: 1
    },
    title: {
      type: 'string'
    },
    timestamp: {
      type: 'string'
    },
    user: objectid,
    parent: {
      type: 'object'
    },
    popularity: {
      type: 'number',
      minimum: 0
    },
    theme: {
      type: 'object',
      properties: {
        default: objectid
      }
    },
    transition: {
      type: 'object',
      properties: {
        default: objectid
      }
    },
    comment: {
      type: 'string'
    },
    abstract: {
      type: 'string'
    },
    footer: {
      type: 'object',
      properties: {
        text: {
          type: 'string'
        }
      }
    },
    license: {
      type: 'string',
      enum: ['CC0', 'CC BY', 'CC BY-SA']
    },
    isFeatured: {
      type: 'number'
    },
    priority: {
      type: 'number'
    },
    visibility: {
      type: 'boolean'
    },
    language: {
      type: 'string'
    },
    translation: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['original', 'google', 'revised']
        },
        source: {
          type: 'object'
        }
      }
    },
    tags: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    preferences: {
      type: 'array',
      items: {
        type: 'object'
      }
    },
    contentItems: {
      type: 'array',
      items: contentItem
    },
    dataSources: {
      type: 'array',
      items: objectid
    }
  },
  required: ['id', 'timestamp', 'user', 'license']
};
const deck = {
  type: 'object',
  properties: {
    timestamp: {
      type: 'string'
    },
    user: objectid,
    description: {
      type: 'string'
    },
    language: {
      type: 'string'
    },
    translation: {
      type: 'object'
    },
    lastUpdate: {
      type: 'string'
    },
    revisions: {
      type: 'array',
      items: deckRevision
    },
    tags: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },
  required: ['timestamp', 'user']
};

//export
module.exports = ajv.compile(deck);
