'use strict';

const Joi = require('joi'),
    handlers = require('./controllers/handler');


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
            description: 'Get editors (owners and contributors) of a deck and its sub-components'
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
                    tags: Joi.array().items(Joi.string()).default([]),
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
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
                }).requiredKeys('user', 'license'),
            },
            tags: ['api'],
            description: 'Create a new deck'
        }
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}',
        handler: handlers.updateDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    description: Joi.string(),
                    language: Joi.string(),
                    translation: Joi.string().alphanum().lowercase(),
                    tags: Joi.array().items(Joi.string()).default([]),
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
                    new_revision: Joi.boolean()
                }).requiredKeys('user'),
            },
            tags: ['api'],
            description: 'Replace a deck by creating a new revision'
        }
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}/fork',
        handler: handlers.forkDeckRevision,
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
        path: '/deck/revert/{id}',
        handler: handlers.revertDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    revision_id: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string()
                }).requiredKeys('revision_id'),
            },
            tags: ['api'],
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
                    tags: Joi.array().items(Joi.string()).default([]),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
                }).requiredKeys('user', 'content', 'root_deck', 'license'),
            },
            tags: ['api'],
            description: 'Create a new slide'
        }
    });

// TODO Altered API from Alis proposal
    server.route({
        method: 'PUT',
        path: '/slide/{id}',
        //for now, no new revision on replace
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
                    tags: Joi.array().items(Joi.string()).default([]),
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
        handler: handlers.revertSlideRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    revision_id: Joi.string().alphanum().lowercase(),
                    root_deck: Joi.string()
                }).requiredKeys('revision_id', 'root_deck'),
            },
            tags: ['api'],
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
};
