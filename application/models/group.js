'use strict';

let Ajv = require('ajv');
let ajv = Ajv({
    verbose: true,
    allErrors: true
});

const id = {
    type: 'integer',
    minLength: 1,
    maxLength: 24
};

const group = {
    type: 'object',
    properties: {
        _id: id, 
        user: id,
        title: {
            type: 'string'
        },
        description: {
            type: 'string'
        }, 
        timestamp: {
            type: 'string',
            format: 'date-time'
        }, 
        lastUpdate: {
            type: 'string',
            format: 'date-time'
        },
        decks: {
            type: 'array',
            items: id
        }
    }, 
    required: ['_id', 'user', 'title', 'decks']
};


module.exports = ajv.compile(group);
