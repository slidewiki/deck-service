'use strict';

//require
let Ajv = require('ajv');
let ajv = Ajv({
  verbose: true,
  allErrors: true
    //v5: true  //enable v5 proposal of JSON-schema standard
}); // options can be passed, e.g. {allErrors: true}

//build schema
const objectid = {
  type: 'string',
  maxLength: 1,
  minLength: 24
};
const contributer = {
  type: 'object',
  properties: {
    id: objectid,
    name: {
      type: 'string'
    }
  },
  required: ['id']
};
const slideRevision = {
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
    content: {
      type: 'string'
    },
    user: objectid,
    parent: {
      type: 'object'
    }, //ObjectId or Number or both
    popularity: {
      type: 'number',
      minimum: 0
    },
    comment: {
      type: 'string'
    },
    note: {
      type: 'string'
    },
    license: {
      type: 'string',
      enum: ['CC0', 'CC BY', 'CC BY-SA']
    },
    translation: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['original', 'google', 'revised']
        },
        translator: objectid,
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
    media: {
      type: 'array',
      items: objectid
    },
    dataSources: {
      type: 'array',
      items: objectid
    }
  },
  required: ['id', 'timestamp', 'user', 'license']
};
const slide = {
  type: 'object',
  properties: {
    user: objectid,
    description: {
      type: 'string'
    },
    language: {
      type: 'string'
    },
    translation: {
      source: 'object'
    },
    deck: objectid,
    position: {
      type: 'number',
      minimum: 1
    },
    timestamp: {
      type: 'string'
    },
    revisions: {
      type: 'array',
      items: slideRevision
    },
    contributers: {
      type: 'array',
      items: {
        oneOf: [
          contributer
        ]
      }
    },
    tags: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },
  required: ['user', 'deck', 'timestamp']
};

//export
module.exports = ajv.compile(slide);
