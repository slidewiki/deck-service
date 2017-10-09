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
        owner: id,
        title: {
            type: 'string'
        },
        description: {
            type: 'string'
        }, 
        decks: {
            type: 'array',
            items: id
        }
    }, 
    required: ['_id', 'owner', 'title', 'decks']
};


module.exports = ajv.compile(group);
