'use strict';

const Joi = require('joi'),
    handlers = require('./controllers/handler');

const slides = require('./controllers/slides');
const decks = require('./controllers/decks');
const deckTrees = require('./controllers/deckTrees');
const changeLog = require('./controllers/changeLog');
const archives = require('./controllers/archives');
const groups = require('./controllers/groups');

const availableThemes = Joi.string()
.default('default').empty('')
.valid('', 'default', 'sky', 'beige', 'black', 'blood', 'league', 'moon', 'night', 'odimadrid', 'oeg', 'openuniversity', 'simple', 'solarized', 'white')
.description('Available themes to apply to the thumbnail');

const slideDimensions = Joi.object().keys({
    width: Joi.number().integer().positive(),
    height: Joi.number().integer().positive(),
});

const slideTransition = Joi.string().valid('none', 'concave', 'convex', 'fade', 'slide', 'zoom');

const educationLevel = Joi.string().regex(/^[0-9]{1,3}$/).description('The education level targeted by the deck using a code from ISCED 2011 standard');

// TODO better organize joi validation models
const apiModels = {};

apiModels.tag = require('./models/JoiModels/tag');
apiModels.group = require('./models/JoiModels/group');

// only support two-character language codes
// TODO also add validation: regex(/[a-z]{2}([_-][A-Z]{2})?/)
const languageModel = Joi.string().max(2).truncate().lowercase().regex(/[a-z]{2}/);

module.exports = function(server) {

    //------------------------------- deck routes -----------------------------//

    server.route({
        method: 'GET',
        path: '/decks',
        handler: decks.listDecks,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().description('JWT header provided by /login')
                }).unknown(),
                query: {
                    user: Joi.number().integer().description('Return only decks owned by user with set id'),
                    usergroup: Joi.number().integer().description('Return only decks owned or managed by the user group'),
                    rootsOnly: Joi.boolean().truthy('1').falsy('0', '').default(false).description('Return only root decks, i.e. decks that are not subdecks'),
                    idOnly: Joi.boolean().truthy('1').falsy('0', '').default(false).description('Return only deck ids, no metadata. Ignores paging, roles, status or authentication'),
                    roles: Joi.string().regex(/^(owner(,editor)?)$|^(editor(,owner)?)$/).empty('').description('A comma delimited list of roles (values: [owner, editor])'),
                    status: Joi.string().valid('public', 'hidden', 'any').empty('').default('public').description('Specify whether to include hidden decks, only public, or all. Ignored if no authentication provided.'),
                    sort: Joi.string().valid('id', 'title', 'lastUpdate', 'timestamp').default('id'),
                    page: Joi.number().integer().positive().default(1).description('Page number'),
                    pageSize: Joi.number().integer().positive().default(10).description('Number of items per page'),
                },
            },
            tags: ['api'],
            auth: {
                strategy: 'jwt',
                mode: 'optional'
            },
            description: 'Retrieve deck metadata with optional filter, sorting, and paging parameters (until paging is implemented, user param is required)',
        }
    });


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
                query: {
                    language: languageModel.empty(''),
                    root: Joi.string().description('Identifier of root deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Get metadata of a deck'
        }
    });

    // new route to eventually replace the PUT method
    server.route({
        method: 'PATCH',
        path: '/deck/{id}',
        handler: decks.updateDeck,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('Identifier of the deck (without revision)'),
                },
                payload: {
                    user: Joi.number().integer().description('Identifier of the new deck owner').required(),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Update metadata of a deck',
        },
    });

    server.route({
        method: 'DELETE',
        path: '/deck/{id}',
        handler: decks.deleteDeck,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('Identifier of the deck to delete'),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Delete a deck',
        },
    });

    server.route({
        method: 'GET',
        path: '/legacy/{oldId}',
        handler: handlers.getLegacyDeckId,
        config: {
            validate: {
                params: {
                    oldId: Joi.string()
                }
            },
            tags: ['api'],
            description: 'Get new id of a legacy deck'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/contributors',
        handler: decks.getContributors,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    language: languageModel.empty(''),
                },
            },
            tags: ['api'],
            description: 'Get the users that have contributed in any way in the deck content',
        },
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/editors',
        handler: handlers.getEditors,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional and will be ignored'),
                },
            },
            tags: ['api'],
            description: 'Get the users and groups authorized for editing the deck',
            response: {
                schema: Joi.object().keys({
                    editors: Joi.object().keys({
                        users: Joi.array().items({
                            id: Joi.number(),
                            joined: Joi.string().isoDate(),
                        }),
                        groups: Joi.array().items({
                            id: Joi.number(),
                            joined: Joi.string().isoDate(),
                        })
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
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional and will be ignored'),
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
                    }).required().options({ stripUnknown: true }),
                }),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Replace the users and groups authorized for editing the deck',
            response: {
                emptyStatusCode: 204,
                status: { '204' : false }
            },
        },
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/requestEditRights',
        handler: handlers.requestEditRights,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Apply for edit rights on the deck',
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
            description: 'Get the permissions the current user has on the deck (revision)',
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
        method: 'POST',
        path: '/deck/new',
        handler: handlers.newDeck,
        config: {
            validate: {
                payload: Joi.object().keys({
                    description: Joi.string().allow('').default(''),
                    language: languageModel.default('en'),
                    translation: Joi.object().keys({
                        status: Joi.string().valid('original', 'google', 'revised')
                    }),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    title: Joi.string(),
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
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA').default('CC BY-SA'),
                    theme : availableThemes,
                    slideDimensions: slideDimensions,
                    editors: Joi.object().keys({
                        groups: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([]),
                        users: Joi.array().items(Joi.object().keys({
                            id: Joi.number().required(),
                            joined: Joi.string().isoDate().required(),
                        })).default([])
                    }),
                    hidden: Joi.boolean().default(true),
                    educationLevel: educationLevel.allow(null),
                    empty: Joi.boolean().default(false).description('Set this to true to skip adding a new slide under the new deck'),
                }),

                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
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
                    description: Joi.string().allow('').default(''),
                    language: languageModel,
                    translation: Joi.string().alphanum().lowercase(),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    title: Joi.string(),
                    allowMarkdown: Joi.boolean(),
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
                    theme : availableThemes,
                    slideDimensions: slideDimensions,
                    new_revision: Joi.boolean(),
                    hidden: Joi.boolean(),
                    educationLevel: educationLevel.allow(null),
                }),

                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
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
        handler: handlers.forkDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Create a fork of a deck, by creating a new revision'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/revisions',
        handler: handlers.getDeckRevisions,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
            },
            tags: ['api'],
            description: 'List all deck revisions meta data for current deck',
        },
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/translations',
        handler: handlers.getDeckVariants,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'List all deck translations for current deck',
        },
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/translations',
        handler: handlers.addDeckVariant,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                payload: {
                    language: languageModel.required(),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Set a language as part of the list of available translations of a deck',
        },
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/revision',
        handler: handlers.createDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                payload: Joi.object().keys({
                    root_deck: Joi.string().description('The deck id-revision string for the subdeck parent'),
                    top_root_deck: Joi.string().description('The deck id-revision string for the root of the deck tree'),
                }).requiredKeys('top_root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Create a new revision for the deck, and optionally update reference of parent deck',
        },
    });

    server.route({
        method: 'POST',
        path: '/deck/{id}/revert',
        handler: handlers.revertDeckRevision,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                payload: Joi.object().keys({
                    revision_id: Joi.string().alphanum().lowercase().description('The revision id the deck should be reverted to'),
                    root_deck: Joi.string().description('The deck id-revision string for the subdeck parent'),
                    top_root_deck: Joi.string().description('The deck id-revision string for the root of the deck tree'),
                }).requiredKeys('revision_id', 'top_root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Revert a deck to an old revision, and optionally update reference of parent deck',
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
                    id: Joi.string(),
                },
                query: {
                    root: Joi.string().description('Identifier of root deck in the form {id}-{revision}, revision is optional'),
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
                    language: languageModel.empty(''),
                    limit: Joi.string().optional(),
                    offset: Joi.string().optional(),
                    countOnly: Joi.boolean().truthy('1').falsy('0', ''),
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
                    language: languageModel,
                    comment: Joi.string().allow(''),
                    description: Joi.string().allow('').default(''),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA').default('CC BY-SA'),
                    dimensions: slideDimensions,
                    transition: slideTransition,
                }).requiredKeys('content', 'root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Create a new slide'
        }
    });

    server.route({
        method: 'PUT',
        path: '/slide/{id}',
        handler: handlers.updateSlideNode,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.object().keys({
                    title: Joi.string(),
                    content: Joi.string(),
                    markdown: Joi.string(),
                    speakernotes: Joi.string(),
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
                    description: Joi.string().allow('').default(''),
                    tags: Joi.array().items(apiModels.tag).default([]),
                    position: Joi.string().alphanum().lowercase().min(0),
                    language: languageModel,
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                    dimensions: slideDimensions,
                    transition: slideTransition,
                    dataSources: Joi.array().items(Joi.object().keys({
                        type: Joi.string(),
                        title: Joi.string(),
                        url: Joi.string().allow(''),
                        comment: Joi.string().allow(''),
                        authors: Joi.string().allow(''),
                        year: Joi.string().allow('')
                    })).default([])
                }).requiredKeys('top_root_deck'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Replace a slide with a new revision'
        }
    });

    server.route({
        method: 'POST',
        path: '/slide/{id}/revert',
        handler: handlers.revertSlideRevision,
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
        method: 'GET',
        path: '/slide/{id}/contributors',
        handler: slides.getContributors,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form {id}-{revision}'),
                },
            },
            tags: ['api'],
            description: 'Get the users that have contributed in any way in the slide content',
        },
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/datasources',
        handler: handlers.getDeckDataSources,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    language: languageModel.empty(''),
                    countOnly: Joi.boolean().truthy('1').falsy('0', ''),
                },
            },
            tags: ['api'],
            description: 'Get the data sources for a deck',
        },
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/datasources',
        handler: handlers.getSlideDataSources,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form {id}-{revision}'),
                },
                query: {
                    countOnly: Joi.boolean().truthy('1').falsy('0', ''),
                },
            },
            tags: ['api'],
            description: 'Get the data sources for a slide',
        },
    });

    server.route({
        method: 'PUT',
        path: '/slide/{id}/datasources',
        handler: handlers.saveDataSources,
        config: {
            validate: {
                params: {
                    id: Joi.string()
                },
                payload: Joi.array().items(Joi.object().keys({
                    type: Joi.string(),
                    title: Joi.string(),
                    url: Joi.string().allow(''),
                    comment: Joi.string().allow(''),
                    authors: Joi.string().allow(''),
                    year: Joi.string().allow('')
                })),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Replace slide data sources'
        }
    });

    //----------------------------- Thumbnail regen routes -----------------------------//
    server.route({
        method: 'POST',
        path: '/deck/{id}/thumbnails',
        handler: handlers.regenThumbnails,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional')
                },
                query: {
                    force: Joi.boolean().truthy('1').falsy('0', ''),
                },
            },
            tags: ['api'],
            description: 'Triggers regeneration of thumbnails for all slides under the specified deck.',
        },
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
                },
                query: {
                    language: languageModel.empty(''),
                    enrich: Joi.boolean().truthy('1').falsy('0', ''),
                }
            },
            tags: ['api'],
            description: 'Get the deck tree'
        }
    });

    server.route({
        method: 'POST',
        path: '/decktree/node/create',
        handler: deckTrees.createDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().empty(''),
                        stype: Joi.string(),
                        sid: Joi.string(),
                    }),
                    nodeSpec: Joi.array().items(
                        Joi.object().keys({
                            id: Joi.string(),
                            type: Joi.string(),
                            root: Joi.string(),

                            // if type is deck, both may be used if available, 
                            // otherwise only `slide` payload
                            deck: Joi.object().keys({
                                title: Joi.string(),
                                description: Joi.string().allow('').default(''),
                                language: languageModel,
                                license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                                theme: availableThemes,
                                allowMarkdown: Joi.boolean(),
                                slideDimensions: slideDimensions,
                                educationLevel: educationLevel.allow(null),
                                empty: Joi.boolean().default(false).description('Set this to true to skip adding a new slide under the new deck'),
                            }).options({ stripUnknown: true }),

                            slide: Joi.object().keys({
                                title: Joi.string(),
                                content: Joi.string(),
                                markdown: Joi.string().allow([null, '']).empty([null, '']),
                                speakernotes: Joi.string().allow([null, '']).empty([null, '']),
                                language: languageModel,
                                license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA'),
                                dimensions: slideDimensions,
                                transition: slideTransition,
                            }).options({ stripUnknown: true }),

                        })
                    ).single(),
                    // TODO remove the following
                    content: Joi.string(),
                    title: Joi.string(),
                    license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA').default('CC BY-SA'),
                    speakernotes: Joi.string(),
                }).requiredKeys('selector'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Create a new node (slide/deck) in the deck tree'
        }
    });

    server.route({
        method: 'PUT',
        path: '/decktree/node/rename',
        handler: deckTrees.renameDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    language: languageModel,
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().empty(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    name: Joi.string(),
                }).requiredKeys('selector'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Rename a node (slide/deck) in the deck tree'
        }
    });

    server.route({
        method: 'DELETE',
        path: '/decktree/node/delete',
        handler: deckTrees.removeDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    selector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().empty(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    purge: Joi.boolean().default(false),
                }).requiredKeys('selector'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Delete a node (slide/deck) from the deck tree'
        }
    });

    server.route({
        method: 'PUT',
        path: '/decktree/node/move',
        handler: deckTrees.moveDeckTreeNode,
        config: {
            validate: {
                payload: Joi.object().keys({
                    sourceSelector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().empty(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    targetSelector: Joi.object().keys({
                        id: Joi.string(), //id of the root deck
                        spath: Joi.string().empty(''),
                        stype: Joi.string(),
                        sid: Joi.string()
                    }),
                    targetIndex: Joi.number()
                }).requiredKeys('sourceSelector', 'targetSelector', 'targetIndex'),
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Move a node (slide/deck) in a different position in the deck tree'
        }
    });

    let cors;
    if (process.env.URL_PLATFORM) {
        // define the cors settings
        cors = { origin: [] };
        cors.origin.push(process.env.URL_PLATFORM);
    }

    server.route({
        method: 'GET',
        path: '/decktree/{id}/translations',
        handler: deckTrees.getDeckTreeVariants,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'List the translations available for all deck tree nodes',
            // needed for presentation rooms feature
            cors,
        },
    });

    server.route({
        method: 'GET',
        path: '/decktree/node/translations',
        handler: handlers.getDeckTreeNodeVariants,
        config: {
            validate: {
                query: {
                    id: Joi.string().required(),
                    spath: Joi.string().empty(''),
                    stype: Joi.string().empty(''),
                    sid: Joi.string().empty(''),
                },
            },
            tags: ['api'],
            description: 'List the translations available for a deck tree node (slide or subdeck)',
        },
    });

    server.route({
        method: 'POST',
        path: '/decktree/node/translations',
        handler: handlers.addDeckTreeNodeVariant,
        config: {
            validate: {
                payload: Joi.object().keys({
                    language: languageModel,
                    selector: Joi.object().keys({
                        id: Joi.string(),
                        spath: Joi.string().empty(''),
                        stype: Joi.string().default('slide'),
                        sid: Joi.string(),
                    }).requiredKeys('id', 'sid'),
                }).requiredKeys('language'),

                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Add a translation for a deck tree node (slide only)',
        },
    });

    server.route({
        method: 'GET',
        path: '/decktree/{id}/export',
        handler: deckTrees.exportDeckTree,
        config: {
            validate: {
                params: {
                    id: Joi.string(),
                },
                query: {
                    firstLevel: Joi.boolean().default(false),
                }
            },
            tags: ['api'],
            description: 'Retrieve full data for the entire deck tree and slides',
        },
    });

    //----------------------------- Archives Routes -----------------------------//

    // TODO add other valid values
    let archiveReason = Joi.string().valid('spam', 'delete').description('Reason for archiving the deck tree');

    server.route({
        method: 'POST',
        path: '/decktree/{id}/archive',
        handler: archives.archiveDeckTree,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('The deck id (without revision)'),
                },
                payload: {
                    secret: Joi.string(),
                    reason: archiveReason.required(),
                    comment: Joi.string().description('A comment with more details about the reason for archiving'),
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login'),
                }).unknown(),
            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Archive a deck tree',
        },
    });

    server.route({
        method: 'GET',
        path: '/archives/decks/',
        handler: archives.listArchivedDecks,
        config: {
            validate: {
                query: {
                    user: Joi.number().integer().description('Identifier of a user that originally owned the archived decks requested'),
                    archivedBy: Joi.number().integer().description('Identifier of the user that performed the archiving'),
                    reason: archiveReason,
                },
            },
            tags: ['api'],
            description: 'List archived decks',
        },
    });

    server.route({
        method: 'GET',
        path: '/archives/deck/{id}',
        handler: archives.getArchivedDeck,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('Identifier of an archived deck'),
                },
            },
            tags: ['api'],
            description: 'Retrieve information about an archived deck',
        },
    });

    //----------------------------- Usage Routes -----------------------------//
    server.route({
        method: 'GET',
        path: '/deck/{id}/usage',
        handler: handlers.getDeckUsage,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Locate the parent decks of the deck if any',
        },
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/usage',
        handler: handlers.getSlideUsage,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Locate the parent decks of the slide',
        },
    });

    //----------------------------- Usage Routes -----------------------------//
    server.route({
        method: 'GET',
        path: '/deck/{id}/rootDecks',
        handler: handlers.getDeckRootDecks,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Locate the root parent decks of the deck if any',
        },
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/rootDecks',
        handler: handlers.getSlideRootDecks,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Locate the root parent decks of the slide',
        },
    });

    //------------------------------- Tag Routes -----------------------------//
    server.route({
        method: 'GET',
        path: '/deck/{id}/tags',
        handler: handlers.getDeckTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional')
                },
            },
            tags: ['api'],
            description: 'Get tags of a deck',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
            plugins: {
                'hapi-swagger': {
                    deprecated: true,
                },
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
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional')
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
            plugins: {
                'hapi-swagger': {
                    deprecated: true,
                },
            },
        }
    });

    server.route({
        method: 'PUT',
        path: '/deck/{id}/tags',
        handler: handlers.replaceDeckTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional')
                },
                payload: Joi.object().keys({
                    top_root_deck: Joi.string().description('The deck id-revision string for the root of the deck tree'),
                    tags: Joi.array().items(apiModels.tag).single(),
                }).requiredKeys('top_root_deck', 'tags'),

                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),

            },
            tags: ['api'],
            auth: 'jwt',
            description: 'Replace tags of a deck -- JWT needed',
        }
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/tags',
        handler: handlers.getSlideTags,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form {id}-{revision}')
                },
            },
            tags: ['api'],
            description: 'Get tags of a slide',
            response: {
                schema: Joi.array().items(apiModels.tag),
            },
            plugins: {
                'hapi-swagger': {
                    deprecated: true,
                },
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
                    id: Joi.string().description('Identifier of slide in the form {id}-{revision}')
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
            plugins: {
                'hapi-swagger': {
                    deprecated: true,
                },
            },
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/media',
        handler: handlers.getDeckMedia,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    mediaType: Joi.string().valid('pictures', 'video', 'audio').required()
                }
            },
            tags: ['api'],
            description: 'Get media inside a deck',
            response: {
                schema: Joi.array().items(Joi.string()),
            },
        }
    });

    //------------------------------- Change Log Routes -----------------------------//

    server.route({
        method: 'GET',
        path: '/deck/{id}/changes',
        handler: changeLog.getDeckChangeLog,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    language: languageModel.empty(''),
                    simplify: Joi.boolean().truthy('1').falsy('0', ''),
                    raw: Joi.boolean().truthy('1').falsy('0', ''),
                },
            },
            tags: ['api'],
            description: 'Get the change log array for a deck (revision)',
        }
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/changes',
        handler: changeLog.getSlideChangeLog,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of slide in the form {id}-{revision}, revision is optional and will be ignored'),
                },
                query: {
                    root: Joi.string().description('Identifier of deck tree root in the form {id}-{revision}, revision is optional').required(),
                    language: languageModel.empty(''),
                    simplify: Joi.boolean().truthy('1').falsy('0', ''),
                    raw: Joi.boolean().truthy('1').falsy('0', ''),
                },
            },
            tags: ['api'],
            description: 'Get the change log array for a slide',
        }
    });


    //------------------------------- Deep Usage Routes -----------------------------//

    server.route({
        method: 'GET',
        path: '/deck/{id}/deepUsage',
        handler: handlers.getDeckDeepUsage,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    keepVisibleOnly: Joi.boolean().default(true)
                },
            },
            tags: ['api'],
            description: 'Get deep usage (decks that point to it directly or indirectly) of a deck',
        }
    });

    server.route({
        method: 'GET',
        path: '/slide/{id}/deepUsage',
        handler: handlers.getSlideDeepUsage,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    keepVisibleOnly: Joi.boolean().default(true)
                },
            },
            tags: ['api'],
            description: 'Get deep usage (decks that point to it directly or indirectly) of a slide',
        }
    });

    //------------------------------- Fork Group Route -----------------------------//

    server.route({
        method: 'GET',
        path: '/deck/{id}/forkGroup',
        handler: handlers.getForkGroup,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
            },
            tags: ['api'],
            description: 'Get the set of all decks that are part of a deck fork chain',
        }
    });

    server.route({
        method: 'GET',
        path: '/deckOwners',
        handler: decks.getDeckOwners,
        config: {
            validate: {
                query: {
                    user: Joi.string().regex(/[0-9](,[0-9])*/).empty('').description('A comma delimited list of user ids'),
                },
            },
            tags: ['api'],
            description: 'Retrieve decks with optional filter, sorting, and paging parameters'
        }
    });

    //------------------------------- Deck Group Routes -----------------------------//

    server.route({
        method: 'GET',
        path: '/group/{id}',
        handler: groups.get,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer().description('id of the group to retrieve'),
                },
            },
            tags: ['api'],
            description: 'Retrieve a deck group',
            response: {
                schema: apiModels.group.getModel
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/groups',
        handler: groups.insert,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                payload: apiModels.group.newModel
            },
            tags: ['api'],
            description: 'Create a new deck group',
            auth: 'jwt',
            response: {
                schema: apiModels.group.getModel
            }
        }
    });

    server.route({
        method: 'PUT',
        path: '/group/{id}',
        handler: groups.replaceMetadata,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                params: {
                    id: Joi.number().integer()
                },
                payload: apiModels.group.onlyMetadata
            },
            tags: ['api'],
            description: 'Replace metadata of an existing deck group',
            auth: 'jwt',
            response: {
                schema: apiModels.group.getModel
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/group/{id}/decks',
        handler: decks.listGroupDecks,
        config: {
            validate: {
                params: {
                    id: Joi.number().integer()
                },
                headers: Joi.object({
                    '----jwt----': Joi.string().description('JWT header provided by /login')
                }).unknown(),
            },
            tags: ['api'],
            description: 'Get the list of decks in group', 
            auth: {
                strategy: 'jwt',
                mode: 'optional'
            },
        }
    });

    server.route({
        method: 'PUT',
        path: '/group/{id}/decks',
        handler: groups.replaceDecks,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                params: {
                    id: Joi.number().integer()
                },
                payload: apiModels.group.onlyDecks
            },
            tags: ['api'],
            description: 'Replace decks of an existing deck group',
            auth: 'jwt',
            response: {
                schema: apiModels.group.getModel
            }
        }
    });

    server.route({
        method: 'PATCH',
        path: '/group/{id}/decks',
        handler: groups.updateDecks,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                params: {
                    id: Joi.number().integer()
                },
                payload: Joi.array().items(apiModels.group.updateOp)
            },
            tags: ['api'],
            description: 'Add/Remove deck ids from the deck group',
            auth: 'jwt',
            response: {
                schema: apiModels.group.getModel
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/group/{id}',
        handler: groups.delete,
        config: {
            validate: {
                headers: Joi.object({
                    '----jwt----': Joi.string().required().description('JWT header provided by /login')
                }).unknown(),
                params: {
                    id: Joi.number().integer()
                },
            },
            response: {
                emptyStatusCode: 204
            },
            tags: ['api'],
            description: 'Delete a deck group',
            auth: 'jwt'
        }
    });

    server.route({
        method: 'GET',
        path: '/deck/{id}/groups',
        handler: groups.getDeckGroups,
        config: {
            validate: {
                params: {
                    id: Joi.string().description('Identifier of deck in the form {id}-{revision}, revision is optional'),
                },
                query: {
                    user: Joi.number().integer().description('Optionally filter with deck group owner id'),
                    usergroup: [
                        Joi.number().integer().description('a user group id'),
                        Joi.array().items(Joi.number().integer()).description('array of user group ids')
                    ], 
                    countOnly: Joi.boolean().truthy('1').falsy('0', ''),
                }
            },
            tags: ['api'],
            description: 'Retrieve the deck\'s deck groups'
        }
    });

    server.route({
        method: 'GET',
        path: '/groups',
        handler: groups.list,
        config: {
            validate: {
                query: {
                    user: Joi.number().integer().description('a user id'),
                    usergroup: [
                        Joi.number().integer().description('a user group id'),
                        Joi.array().items(Joi.number().integer()).description('array of user group ids')
                    ],
                    page: Joi.number().integer().min(0).default(0).required().description('page to be retrieved'),
                    per_page: Joi.number().integer().positive().default(20).required().description('number of results within a page')
                },
            },
            tags: ['api'],
            description: 'Get a list of deck groups',
            response: {
                schema: Joi.object().keys({
                    metadata: Joi.object().keys({
                        page: Joi.number(),
                        per_page: Joi.number(),
                        total_count: Joi.number(),
                        links: Joi.object().keys({
                            previous: Joi.string().allow(['', null]),
                            next: Joi.string().allow(['', null]),
                        }),
                    }),
                    documents: Joi.array().items(apiModels.group.getModel),
                }),
            },
        }
    });

};
