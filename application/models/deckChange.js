'use strict';

// model how deck changes are saved in log
const _ = require('lodash');

const deckModel = require('./deck');

let Ajv = require('ajv');
let ajv = Ajv({
    verbose: true,
    allErrors: true
});

const changePath = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            id: {
                type: 'integer',
            },
            revision: {
                type: 'integer',
            },
            index: {
                type: 'integer',
            },
        }
    },
};

const nodeValue = {
    type: 'object',
    properties: {
        kind: {
            type: 'string',
            enum: [ 'deck', 'slide', ],
        },
        ref: {
            type: 'object',
            properties: {
                id: {
                    type: 'integer',
                },
                revision: {
                    type: 'integer',
                },
            },
        },
    },
};

const updateValues = {
    type: 'object',
    properties: _.merge(
        {},
        deckModel.trackedDeckProperties,
        deckModel.trackedDeckRevisionProperties),

};

const deckChange = {
    type: 'object',
    properties: {
        op: {
            type: 'string',
            enum: [ 'add', 'remove', 'replace', 'move', 'update', ],
        },

        path: changePath,
        from: changePath,

        value: nodeValue,
        oldValue: nodeValue,

        values: updateValues,
        oldValues: updateValues,

        user: {
            type: 'integer',
        },

        timestamp: {
            type: 'string',
            format: 'date-time',
        },

    },

};

module.exports = { validate: ajv.compile(deckChange) };
