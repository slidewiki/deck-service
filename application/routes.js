'use strict';

const Joi = require('joi'),
  handlers = require('./controllers/handler'),
  server = require('./server');

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
        body: Joi.string(),
        user_id: Joi.string().alphanum().lowercase(),
        root_deck_id: Joi.string().alphanum().lowercase(),
        parent_deck_id: Joi.string().alphanum().lowercase(),
        no_new_revision: Joi.boolean(),
        position: Joi.number().integer().min(0),
        language: Joi.string()
      }).requiredKeys('title', 'body'),
    },
    tags: ['api'],
    description: 'Create a new slide'
  }
});

// TODO Altered API from Alis proposal
server.route({
  method: 'PUT',
  path: '/slide/{id}',
  handler: handlers.replaceSlide,
  config: {
    validate: {
      params: {
        id: Joi.string().alphanum().lowercase()
      },
      payload: Joi.object().keys({
        title: Joi.string(),
        body: Joi.string(),
        user_id: Joi.string().alphanum().lowercase(),
        root_deck_id: Joi.string().alphanum().lowercase(),
        parent_deck_id: Joi.string().alphanum().lowercase(),
        no_new_revision: Joi.boolean(),
        position: Joi.number().integer().min(0),
        language: Joi.string()
      }).requiredKeys('title', 'body'),
    },
    tags: ['api'],
    description: 'Replace a slide'
  }
});
