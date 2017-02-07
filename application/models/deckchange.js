'use strict';

const objectid = {
    type: 'integer',
    maxLength: 24,
    minLength: 1
};

const trackedDeckRevisionProperties = {
    title: {
        type: 'string'
    },
    language: {
        type: 'string'
    },
    theme: {
        type: 'object',
        properties: {
            default: objectid
        }
    },

};

const trackedDeckProperties = {
    license: {
        type: 'string',
        enum: [ 'CC0', 'CC BY', 'CC BY-SA' ]
    },
    description: {
        type: 'string'
    },

};

const deckChange = {
    type: 'object',
    properties: {
        operation: {
            type: 'string',
            enum: [ 'update' ],
        },

        timestamp: {
            type: 'string',
            format: 'datetime',
        },

        before: {
            type: 'object',
            properties: trackedDeckProperties,
        },
        after: {
            type: 'object',
            properties: trackedDeckProperties,
        },

    },

};

const deckRevisionChange = {
    type: 'object',
    properties: {
        operation: {
            type: 'string',
            enum: [ 'update', 'insert', 'delete', 'move' ],
        },

        timestamp: {
            type: 'string',
            format: 'datetime',
        },

        before: {
            type: 'object',
            properties: trackedDeckRevisionProperties,
        },
        after: {
            type: 'object',
            properties: trackedDeckRevisionProperties,
        },

    },

};

module.exports = { trackedDeckProperties, trackedDeckRevisionProperties, deckChange, deckRevisionChange };
