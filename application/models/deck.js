'use strict';

//require
const _ = require('lodash');

let Ajv = require('ajv');
let ajv = Ajv({
    verbose: true,
    allErrors: true
    //v5: true  //enable v5 proposal of JSON-schema standard
}); // options can be passed, e.g. {allErrors: true}

//build schema
const objectid = {
    type: 'integer',
    maxLength: 24,
    minLength: 1
};

// needed for tracking changes in decks properties
const trackedDeckProperties = {
    license: {
        type: 'string',
        enum: [ 'CC0', 'CC BY', 'CC BY-SA' ]
    },
    description: {
        type: 'string'
    },

};

// needed for tracking changes in deck revisions properties
const trackedDeckRevisionProperties = {
    title: {
        type: 'string'
    },
    language: {
        type: 'string'
    },

    //NOTE: temporarily store themes with their name
    theme: {
        type: 'string',
    },

};

const contributor = {
    type: 'object',
    properties: {
        user: objectid,
        count: {
            type: 'integer',
            minimum: 1
        }
    },
    required: ['user']
};

//build schema
const contentItem = {
    type: 'object',
    properties: {
        order: {
            type: 'integer',
            minimum: 1
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
                    type: 'integer',
                    minimum: 1
                } //if not given use the last revision
            },
            required: ['id']
        }
    },
    required: ['kind', 'ref']
};

// same as contentItem, just remove some 'required' type attributes
// used in deck revision change log
const contentItemPartial = {
    type: 'object',
    properties: {
        order: {
            type: 'integer',
        },
        kind: {
            type: 'string',
            enum: ['deck', 'slide'],
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

const editors = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: {
                        type: 'number'
                    },
                    name: {
                        type: 'string'
                    },
                    joined: {
                        type: 'string',
                        format: 'date-time'
                    }
                }
            }
        },
        users: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: objectid,
                    username: {
                        type: 'string'
                    },
                    joined: {
                        type: 'string',
                        format: 'date-time'
                    },
                    picture: {
                        type: 'string'
                    }
                }
            }
        }
    }
};

// model how deck revision changes are saved in log
const deckRevisionChange = {
    type: 'object',
    properties: {
        operation: {
            type: 'string',
            enum: [ 'update', 'insert', 'delete', 'move' ],
        },

        timestamp: {
            type: 'string',
            format: 'date-time',
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

const deckRevision = {
    type: 'object',
    properties: _.merge({
        id: { //increment with every new revision
            type: 'number',
            minimum: 1
        },
        timestamp: {
            type: 'string',
            format: 'date-time'
        },
        user: objectid,
        parent: {
            type: 'object',
            // properties: {
            //     id: {
            //         type: 'integer'
            //     },
            //     revision: {
            //         type: 'integer'
            //     }
            // }
        },
        popularity: {
            type: 'number',
            minimum: 0
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
            type: 'string'
        },
        // license: {
        //     type: 'string',
        //     enum: ['CC0', 'CC BY', 'CC BY-SA']
        // },
        isFeatured: {
            type: 'number'
        },
        priority: {
            type: 'number'
        },
        visibility: {
            type: 'boolean'
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
                type: 'object',
                properties: {
                    tagName: {
                        type: 'string',
                    },
                    // TODO add other properties as well in sync with the tag-service
                },
            },
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

        changeLog: {
            type: 'array',
            items: deckRevisionChange
        },

        dataSources: { //is filled out automatically from the slides
            type: 'array',
            items: {
                type: 'string'
            }
        },
        usage: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: objectid,
                    revision: {
                        type: 'number',
                        minimum: 1
                    }
                },
                required: ['id','revision']
            }
        }
    }, trackedDeckRevisionProperties),
    required: ['id', 'timestamp', 'user']
};


// model how deck changes are saved in log
const deckChange = {
    type: 'object',
    properties: {
        operation: {
            type: 'string',
            enum: [ 'update', 'remove', 'insert' ],
        },

        timestamp: {
            type: 'string',
            format: 'date-time',
        },

        before: {
            type: 'object',
            properties: trackedDeckProperties,
        },
        after: {
            type: 'object',
            properties: trackedDeckProperties,
        },

        index: {
            type: 'integer',
        },

        insert: contentItem,
        remove: contentItem,

        update: {
            type: 'object',
            properties: {
                before: contentItemPartial,
                after: contentItemPartial,
            },
        },

    },

};

const deck = {
    type: 'object',
    properties: _.merge({
        timestamp: {
            type: 'string',
            format: 'date-time'
        },
        user: objectid,
        // // TODO include these here after validation is fixed across the service
        // accessLevel: {
        //     type: 'string',
        //     enum: ['public', 'restricted', 'private']
        // },
        // editors: editors,

        // points to fork origin (only for forked decks)
        origin: {
            type: 'object',
            properties: {
                id: {
                    type: 'number',
                },
                revision: {
                    type: 'number',
                },
                title: {
                    type: 'string',
                },
                user: {
                    type: 'integer',
                },
            },
            required: ['id', 'revision'],
        },

        // kind: {
        //     type: 'string'
        // },
        // language: {
        //     type: 'string'
        // },
        // translation: {
        //     type: 'object'
        // },
        lastUpdate: {
            type: 'string',
            format: 'date-time'
        },

        changeLog: {
            type: 'array',
            items: deckChange
        },

        revisions: {
            type: 'array',
            items: deckRevision
        },
        contributors: {
            type: 'array',
            items: {
                contributor
            }
        },
        active: {
            type: 'integer'
        },
        datasource: {
            type: 'string'
        },
        translations: { //put here all translations explicitly - deck ids
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    language: {
                        type: 'string'
                    },
                    deck_id: objectid
                }
            }
        },
        // TODO re-add some validation here after it is fixed on the service level, AND translation info schema is used
        // translated_from: { //if this deck is a result of translation
        //     type: 'object',
        //     properties: {
        //         status: {
        //             type: 'string',
        //             enum: ['original', 'google', 'revised', null]
        //         },
        //         source: {
        //             type: 'object',
        //             properties: {
        //                 id: {
        //                     type: 'number'
        //                 },
        //                 revision: {
        //                     type: 'number'
        //                 }
        //             }
        //         },
        //         translator: {
        //             type: 'object',
        //             properties: {
        //                 id: {
        //                     type: 'number',
        //                 },
        //                 username:{
        //                     type: 'string'
        //                 }
        //             }
        //         }
        //     }
        // }
    }, trackedDeckProperties),
    required: ['timestamp', 'user']
};

//export
module.exports = { validateDeck: ajv.compile(deck), trackedDeckProperties, trackedDeckRevisionProperties };
