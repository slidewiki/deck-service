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
  /*TODO think about deck/slides - missing until now*/
  server.route({
    method: 'GET',
    path: '/deck/tree/{id}',
    handler: handlers.getDeckTree,
    config: {
      validate: {
        params: {
          id: Joi.string().alphanum().lowercase()
        }
      },
      tags: ['api'],
      description: 'Get the deck tree'
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
};
