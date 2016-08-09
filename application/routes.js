'use strict';

const Joi = require('joi'),
  handlers = require('./controllers/handler');


module.exports = function(server) {
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
    method: 'POST',
    path: '/deck/new',
    handler: handlers.newDeck,
    config: {
      validate: {
        payload: Joi.object().keys({
          description: Joi.string(),
          language: Joi.string(),
          translation: Joi.string().alphanum().lowercase(),
          tags: Joi.array().items(Joi.string()).default([]),
          title: Joi.string(),
          user: Joi.string().alphanum().lowercase(),
          root_deck: Joi.string().alphanum().lowercase(),
          parent_deck: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          //position: Joi.string().alphanum().lowercase().min(0),
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
          parent_deck: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          content_items: Joi.array(),
          license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
        }).requiredKeys('user', 'license'),
      },
      tags: ['api'],
      description: 'Replace a deck by creating a new revision'
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
          revision_id: Joi.string().alphanum().lowercase()
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
      },
      tags: ['api'],
      description: 'Get all slide'
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
          root_deck: Joi.string().alphanum().lowercase(),
          parent_deck: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
	//add a field for deck revision?
	/* root_deck : Joi.object().keys({
            id: Joi.string().alphanum().lowercase(), //id of the root deck
            revision: Joi.string().alphanum().lowercase() //revision number of the root deck revision
           }),
        */
          parent_slide: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          position: Joi.string().alphanum().lowercase().min(0),
          language: Joi.string(),
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
    handler: handlers.updateNoRevisionSlide,
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
          license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
        }).requiredKeys('user', 'content', 'root_deck', 'license'),
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
          id: Joi.string().alphanum().lowercase()
        },
        payload: Joi.object().keys({
          revision_id: Joi.string().alphanum().lowercase()
        }).requiredKeys('revision_id'),
      },
      tags: ['api'],
      description: 'Revert a slide to an old revision'
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
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.string()
          }),
          nodeSpec: Joi.object().keys({
            id: Joi.string(),
            type: Joi.string()
          }),
          user: Joi.string().alphanum().lowercase()
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
