'use strict';

const Joi = require('joi'),
    handlers = require('./controllers/handler');

// TODO better organize joi validation models
const apiModels = {};
apiModels.tag = Joi.object().keys({
    tagName: Joi.string(),
}).requiredKeys('tagName');

module.exports = function(server) {

    server.route({
        method: 'GET',
        path: '/alldecks/{userid}',
        handler: handlers.getAllDecks,
        config: {
            validate: {
                params: {
                    userid: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get all decks of a user as metadata'
        }
    });

    server.route({
        method: 'GET',
        path: '/allfeatured/{limit}/{offset}',
        handler: handlers.getAllFeatured,
        config: {
            validate: {
                params: {
                    limit: Joi.string(),
                    offset: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get all featured decks as metadata with a possibility to set limit and offset'
        }
    });

    server.route({
        method: 'GET',
        path: '/allrecent/{limit}/{offset}',
        handler: handlers.getAllRecent,
        config: {
            validate: {
                params: {
                    limit: Joi.string(),
                    offset: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get all recent decks as metadata with a possibility to set limit and offset'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}',
        handler: handlers.getDeck,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get metadata of a deck'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/needsNewRevision',
        handler: handlers.needsNewRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                query: {
                    user: Joi.string()
                }
            },
            tags: ['api'],
            description: 'Decide if deck needs new revision.'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/forkAllowed',
        handler: handlers.forkAllowed,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of the deck. DeckId-RevisionNumber')
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Decide if deck can be forked by the user - JWT needed',
            response: {
                schema: Joi.object().keys({
                    forkAllowed: Joi.boolean()
                }).required().description('Return schema')
            },
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/handleChange',
        handler: handlers.handleChange,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                query: {
                    root_deck: Joi.string(),
                    user: Joi.string()
                }
            },
            tags: ['api'],
            description: 'Checks the decktree to see which decks need new revisions, starting from a given deck up.'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/editors',
        handler: handlers.getEditors,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get the users and groups authorized for editing the deck (includes contributors)',
            response: {
                schema: Joi.object().keys({
                    contributors: Joi.array().items(
                        Joi.object().keys({
                            id: Joi.number(),
                            username: Joi.string(),
                            picture: Joi.string().allow(''),
                        })),
                    editors: Joi.object().keys({
                        users: Joi.array().items(
                            Joi.object().keys({
                                id: Joi.number(),
                                username: Joi.string(),
                                picture: Joi.string().allow(''),
                                joined: Joi.string().isoDate(),
                            })),
                        groups: Joi.array().items(
                            Joi.object().keys({
                                id: Joi.number(),
                                name: Joi.string(),
                                joined: Joi.string().isoDate(),
                            })),
                    }),
                }),
            },
        },
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}/editors',
        handler: handlers.replaceEditors,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                payload: Joi.object().keys({
                    editors: Joi.object().keys({
                        groups: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([]),
                        users: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([])
                    }).required(),
                }),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Replace the users and groups authorized for editing the deck - JWT needed',
            response: {
                emptyStatusCode: 204,
                status: { '204' : false }
            },
        },
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/permissions',
        handler: handlers.userPermissions,
        config: {
            validate: {
                params: {
                    id: Joi.string().regex(/[0-9]+/),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Get the permissions the current user has on the deck (revision) - JWT needed',
            response: {
                schema: Joi.object({
                    fork: Joi.boolean(),
                    edit: Joi.boolean(),
                    admin: Joi.boolean(),
                    readOnly: Joi.boolean(),
                }),
            }
        },
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/forkCount',
        handler: handlers.countDeckForks,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                query: {
                    user: Joi.number().integer().description('The id of the user the forks counted are owned by'),
                },
            },
            tags: ['api'],
            description: 'Get total count of forks for this deck, optionally filtered by fork owner'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/revisionCount',
        handler: handlers.countDeckRevisions,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get total count of revisions for this deck'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/slideCount',
        handler: handlers.countSlides,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get total count of slides for this deck'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/editAllowed',
        handler: handlers.editAllowed,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of the deck. DeckId-RevisionNumber')
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown()
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Check if user is allowed to edit the deck - JWT needed',
            response: {
                schema: Joi.object().keys({
                    allowed: Joi.boolean()
                }).required('allowed')
            },
            plugins: {
                'hapi-swagger': {
                    responses: {
                        ' 200 ': {
                            'description': 'Successful',
                        },
                        ' 404 ': {
                            'description': 'Deck not found. Check the id.'
                        }
                    },
                    payloadType: 'form'
                }
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/deck/new',
        handler: handlers.newDeck,
        config: {
            validate: {
                payload: Joi.object().keys({
                    description: Joi.string(),
                    language: Joi.string(),
                    translation: Joi.object().keys({
                        status: Joi.string().valid('original', 'google', 'revised')
                    }),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    title: Joi.string(),
                    user: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string().alphanum().lowercase(),
                    parent_deck: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    abstract: Joi.string().allow(''),
                    comment: Joi.string().allow(''),
                    footer: Joi.string().allow(''),
                    first_slide: Joi.object().keys({
                        content: Joi.string().allow(''),
                        title: Joi.string().allow(''),
                        speakernotes: Joi.string().allow('')
                    }),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                    theme: Joi.string(),
                    editors: Joi.object().keys({
                        groups: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([]),
                        users: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([])
                    })
                }).requiredKeys('user', 'license'),
            },
            tags: ['api'],
            description: 'Create a new deck'
        }
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}',
        handler: handlers.updateDeck,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    description: Joi.string(),
                    language: Joi.string(),
                    translation: Joi.string().alphanum().lowercase(),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    title: Joi.string(),
                    user: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string(),
                    top_root_deck: Joi.string(),
                    parent_deck: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    content_items: Joi.array(),
                    abstract: Joi.string().allow(''),
                    comment: Joi.string().allow(''),
                    footer: Joi.string().allow(''),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                    theme: Joi.string(),
                    new_revision: Joi.boolean(),
                }).requiredKeys('user'),
            },
            tags: ['api'],
            description: 'Replace a deck by creating a new revision'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/forks',
        handler: handlers.getDeckForks,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                query: {
                    user: Joi.number().integer().description('The id of the user the forks returned are owned by'),
                },
            },
            tags: ['api'],
            description: 'List all decks that fork current deck, optionally filtered by fork owner',
        },
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}/fork',
        handler: handlers.forkDeckRevisionWithCheck,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    user: Joi.string().alphanum().lowercase()
                }).requiredKeys('user'),
            },
            tags: ['api'],
            description: 'Create a fork of a deck, by creating a new revision'
        }
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/revision',
        handler: handlers.createDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string(),
                },
                payload: Joi.object().keys({
                    root: Joi.string().required(),
                    parent: Joi.string(),
                }),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Create a new revision for the deck, and optionally update reference of parent deck - JWT needed',
        },
    });

    server.route({
        method: 'POST',
        path: '/deck/revert/{id}',
        handler: handlers.revertDeckRevisionWithCheck,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    revision_id: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string(),
                    top_root_deck: Joi.string(),
                }).requiredKeys('revision_id', 'top_root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Revert a deck to an old revision'
        }
    });

    //slides
    server.route({
        method: 'GET',
        path: '/slide/{id}',
        handler: handlers.getSlide,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get a slide'
        }
    });

    server.route({
        method: 'GET',
        path: '/allslide',
        handler: handlers.getAllSlides,
        config: {
            validate: {
                params: {
                },
            },
            tags: ['api'],
            description: 'Get all slide'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/slides',
        handler: handlers.getFlatSlides,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                query: {
                    limit: Joi.string().optional(),
                    offset: Joi.string().optional()
                }
            },
            tags: ['api'],
            description: 'Get flat slide structure'
        }
    });

    server.route({
        method: 'POST',
        path: '/slide/new',
        handler: handlers.newSlide,
        config: {
            validate: {
                payload: Joi.object().keys({
                    title: Joi.string(),
                    content: Joi.string(),
                    speakernotes: Joi.string(),
                    user: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string(),
                    parent_deck: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    parent_slide: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    position: Joi.string().alphanum().lowercase().min(0),
                    language: Joi.string(),
                    comment: Joi.string().allow(''),
                    description: Joi.string().allow(''),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
                }).requiredKeys('user', 'content', 'root_deck', 'license'),
            },
            tags: ['api'],
            description: 'Create a new slide'
        }
    });

    server.route({
        method: 'PUT',
        path: '/slide/{id}',
        handler: handlers.updateSlide,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    title: Joi.string(),
                    content: Joi.string(),
                    speakernotes: Joi.string(),
                    user: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string(),
                    top_root_deck: Joi.string(),
                    parent_deck: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    parent_slide: Joi.object().keys({
                        id: Joi.string().alphanum().lowercase(),
                        revision: Joi.string().alphanum().lowercase()
                    }),
                    comment: Joi.string().allow(''),
                    description: Joi.string().allow(''),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    position: Joi.string().alphanum().lowercase().min(0),
                    language: Joi.string(),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                    dataSources: Joi.array().items(Joi.object().keys({
                        type: Joi.string(),
                        title: Joi.string(),
                        url: Joi.string().allow(''),
                        comment: Joi.string().allow(''),
                        authors: Joi.string().allow(''),
                        year: Joi.string().allow('')
                    })).default([])
                }).requiredKeys('user', 'content', 'root_deck'),
            },
            tags: ['api'],
            description: 'Replace a slide with a new revision'
        }
    });

    server.route({
        method: 'POST',
        path: '/slide/revert/{id}',
        handler: handlers.revertSlideRevisionWithCheck,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    revision_id: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string(),
                    top_root_deck: Joi.string(),
                }).requiredKeys('revision_id', 'root_deck', 'top_root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Revert a slide to an old revision'
        }
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/revisionCount',
        handler: handlers.countSlideRevisions,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
            },
            tags: ['api'],
            description: 'Get total count of revisions for this slide'
        }
    });

    server.route({
        method: 'PUT',
        path: '/slide/datasources/{id}',
        handler: handlers.saveDataSources,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    dataSources: Joi.array().items(Joi.object().keys({
                        type: Joi.string(),
                        title: Joi.string(),
                        url: Joi.string().allow(''),
                        comment: Joi.string().allow(''),
                        authors: Joi.string().allow(''),
                        year: Joi.string().allow('')
                    })).default([])
                }).requiredKeys('dataSources'),
            },
            tags: ['api'],
            description: 'Replace slide data sources'
        }
    });

    //------------decktree APIs----------------
    server.route({
        method: 'GET',
        path: '/decktree/{id}',
        handler: handlers.getDeckTree,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                }
            },
            tags: ['api'],
            description: 'Get the deck tree'
        }
    });

    server.route({
        method: 'POST',
        path: '/decktree/node/create',
        handler: handlers.createDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().allow(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    nodeSpec: Joi.object().keys({
                        id: Joi.string(),
                        type: Joi.string()
                    }),
                    user: Joi.string().alphanum().lowercase(),
                    content: Joi.string(),
                    title: Joi.string(),
                    license: Joi.string(),
                    speakernotes: Joi.string()
                }).requiredKeys('selector', 'user'),
            },
            tags: ['api'],
            description: 'Create a new node (slide/deck) in the deck tree'
        }
    });

    server.route({
        method: 'PUT',
        path: '/decktree/node/rename',
        handler: handlers.renameDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string(),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    name: Joi.string(),
                    user: Joi.string().alphanum().lowercase()
                }).requiredKeys('selector', 'user'),
            },
            tags: ['api'],
            description: 'Rename a node (slide/deck) in the deck tree'
        }
    });

    server.route({
        method: 'DELETE',
        path: '/decktree/node/delete',
        handler: handlers.deleteDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string(),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    user: Joi.string().alphanum().lowercase()
                }).requiredKeys('selector', 'user'),
            },
            tags: ['api'],
            description: 'Delete a node (slide/deck) from the deck tree'
        }
    });

    server.route({
        method: 'PUT',
        path: '/decktree/node/move',
        handler: handlers.moveDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    sourceSelector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().allow(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    targetSelector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().allow(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    user: Joi.string().alphanum().lowercase(),
                    targetIndex: Joi.number()
                }).requiredKeys('sourceSelector', 'targetSelector', 'user', 'targetIndex'),
            },
            tags: ['api'],
            description: 'Move a node (slide/deck) in a different position in the deck tree'
        }
    });

    //------------------------------- Tag Routes -----------------------------//
    server.route({
        method: 'GET',
        path: '/deck/{id}/tags',
        handler: handlers.getDeckTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form: deckId-deckRevisionId')
                },
            },
            tags: ['api'],
            description: 'Get tags of a deck',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
        }
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/tags',
        handler: handlers.updateDeckTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form: deckId-deckRevisionId')
                },
                payload:
                    Joi.object().keys({
                        operation: Joi.string().valid('add', 'remove'),
                        user: Joi.string().alphanum().lowercase(),
                        tag: apiModels.tag,
                    }).requiredKeys('operation', 'user', 'tag')
            },
            tags: ['api'],
            description: 'Add/Remove a tag from a deck',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
        }
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/tags',
        handler: handlers.getSlideTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form: slideId-slideRevisionId')
                },
            },
            tags: ['api'],
            description: 'Get tags of a slide',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
        }
    });

    server.route({
        method: 'POST',
        path: '/slide/{id}/tags',
        handler: handlers.updateSlideTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form: slideId-slideRevisionId')
                },
                payload:
                    Joi.object().keys({
                        operation: Joi.string().valid('add', 'remove'),
                        user: Joi.string().alphanum().lowercase(),
                        tag: apiModels.tag,
                    }).requiredKeys('operation', 'user', 'tag'),
            },
            tags: ['api'],
            description: 'Add/Remove a tag from a slide',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
        }
    });

};
