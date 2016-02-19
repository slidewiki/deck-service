'use strict';

const Joi = require('joi');
const handlers = require('./controllers/handler');

module.exports = function(server) {
  server.route({
    method: 'GET',
    path: '/deck/{id}',
    handler: null,
    config: {
      validate: {
        params: {
          id: Joi.number().integer().min(0)
        },
        response: Joi.object().keys({
          id: Joi.number().integer().min(0),
          title: Joi.string(),
          description: Joi.string(),
          numberOfSlides: Joi.integer().min(0),
          created_at: Joi.date().timestamp()
        }).requiredKeys('id', 'title', 'description', 'numberOfSlides', 'created_at')
      },
      tags: ['api'],
      description: 'Get matadata of a deck'
    }
  });
  /*TODO think about deck/slides - missing until now*/
  /* Response:
  {
   title: 'root', id:56, type:'deck', position:’1’, children:
      [
        {title: 'child 1', id: 11, type: 'slide', position: ‘1’},
        {title: 'child 2', id: 12, type: 'slide', , position: ‘2’},
        {title: 'child 3', id: 13, type: 'deck', , position: ‘3’, children:[
          {title: 'child 31', id: 131, type: 'slide' , position: ‘1’},
          {title: 'child 32', id: 132, type: 'deck', position: ‘2’, children:[
            {title: 'child 321', id: 1321, type: 'slide' , position: ‘1’},
            {title: 'child 322', id: 1322, type: 'slide', position: ‘2’},
        ]},
        {title: 'child 33', id: 133, type: 'slide', position: ‘3’}
        ]},
        {title: 'child 4', id: 14, type: 'slide', position: ‘4’}
      ]
    }
  */
  server.route({
    method: 'GET',
    path: '/deck/tree/{id}',
    handler: null,
    config: {
      validate: {
        params: {
          id: Joi.number().integer().min(0)
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
          id: Joi.number().integer().min(0)
        },
        response: Joi.object().keys({
          id: Joi.number().integer().min(0),
          title: Joi.string(),
          body: Joi.string(),
          created_at: Joi.date().timestamp()
        }).requiredKeys('id', 'title', 'body', 'created_at')
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
          parent_deck_id: Joi.number().integer().min(0),
          position: Joi.number().integer().min(0),
          user_id: Joi.number().integer().min(0),
          root_deck_id: Joi.number().integer().min(0),
          language: Joi.string()
        }).requiredKeys('title', 'language'),
        response: Joi.object().keys({
          id: Joi.number().integer().min(0),
          title: Joi.string(),
          body: Joi.string(),
          created_at: Joi.date().timestamp(),
          root_deck_changed: Joi.boolean(),
          root_deck_id: Joi.number().integer().min(0)
        }).requiredKeys('id', 'title', 'body', 'created_at', 'root_deck_changed', 'root_deck_id')
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
          id: Joi.number().integer().min(0)
        },
        payload: Joi.object().keys({
          id: Joi.number().integer().min(0),
          title: Joi.string(),
          body: Joi.string(),
          user_id: Joi.number().integer().min(0),
          root_deck_id: Joi.number().integer().min(0),
          parent_deck_id: Joi.number().integer().min(0),
          no_new_revision: Joi.boolean()
        }).requiredKeys('id', 'title', 'body'),
        response: Joi.object().keys({
          id: Joi.number().integer().min(0),
          title: Joi.string(),
          body: Joi.string(),
          root_deck_changed: Joi.boolean(),
          root_deck_id: Joi.number().integer().min(0),
          created_at: Joi.date().timestamp()
        }).requiredKeys('id', 'title', 'body', 'root_deck_changed', 'created_at')
      },
      tags: ['api'],
      description: 'Update a slide'
    }
  });
};
