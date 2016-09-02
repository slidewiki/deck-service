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
    type: 'number',
    maxLength: 24,
    minLength: 1
};
const contributor = {
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
            type: 'string',
            format: 'datetime'
        },
        content: {
            type: 'string'
        },
        speakernotes: {
            type: 'string'
        },
        user: objectid,
        parent: {
            type: 'object',
            properties: {
                id: objectid,
                revision: {
                    type: 'number'
                }
            }
        }, //ObjectId or Number or both
        popularity: {
            type: 'number',
            minimum: 0
        },
        comment: { //revision comment
            type: 'string'
        },
        license: {
            type: 'string',
            enum: ['CC0', 'CC BY', 'CC BY-SA']
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
        },
        usage: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: objectid,
                    revision: {
                        type: 'number'
                    }
                }
            }
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
        timestamp: {
            type: 'string',
            format: 'datetime'
        },
        revisions: {
            type: 'array',
            items: slideRevision
        },
        contributors: {
            type: 'array',
            items: {
                oneOf: [
                    contributor
                ]
            }
        },
        tags: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        active: objectid,
        datasource: {
            type: 'string'
        },
        lastUpdate: {
            type: 'string',
            format: 'datetime'
        }
    },
    required: ['user', 'deck', 'timestamp']
};

//export
module.exports = ajv.compile(slide);
