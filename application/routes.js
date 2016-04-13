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
          id: Joi.string().alphanum().lowercase()
        },
      },
      tags: ['api'],
      description: 'Get matadata of a deck'
    }
  });

  server.route({
    method: 'GET',
    path: '/slide/{id}',
    handler: handlers.getSlide,
    config: {
      validate: {
        params: {
          id: Joi.string().alphanum().lowercase()
        },
      },
      tags: ['api'],
      description: 'Get a slide'
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
          user: Joi.string().alphanum().lowercase(),
          root_deck: Joi.string().alphanum().lowercase(),
          parent_slide: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          position: Joi.number().integer().min(0),
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
    handler: handlers.updateSlide,
    config: {
      validate: {
        params: {
          id: Joi.string().alphanum().lowercase()
        },
        payload: Joi.object().keys({
          title: Joi.string(),
          content: Joi.string(),
          user: Joi.string().alphanum().lowercase(),
          root_deck: Joi.string().alphanum().lowercase(),
          parent_slide: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          position: Joi.number().integer().min(0),
          language: Joi.string(),
          license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
        }).requiredKeys('user', 'content', 'root_deck', 'license'),
      },
      tags: ['api'],
      description: 'Replace a slide'
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
          id: Joi.number().integer()
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
            id: Joi.number().integer(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.number().integer()
          }),
          nodeSpec: Joi.object().keys({
            id: Joi.number().integer(), //0 means it is a new node not existing
            type: Joi.string()
          }),
          user: Joi.number().integer()
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
            id: Joi.number().integer(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.number().integer()
          }),
          name: Joi.string(),
          user: Joi.number().integer()
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
            id: Joi.number().integer(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.number().integer()
          }),
          user: Joi.number().integer()
        }).requiredKeys('selector', 'user'),
      },
      tags: ['api'],
      description: 'Delete a node (slide/deck) from the deck tree'
    }
  });
};
