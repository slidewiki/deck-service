'use strict';

const boom = require('boom'),
  slideDB = require('../database/slideDatabase'),
  deckDB = require('../database/deckDatabase'),
  co = require('../common');

module.exports = {
  getSlide: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    slideDB.get(encodeURIComponent(request.params.id)).then((slide) => {
      if (co.isEmpty(slide))
        reply(boom.notFound());
      else
        reply(co.rewriteID(slide));
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  newSlide: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    slideDB.insert(request.payload).then((slide) => {
      request.log('info',slide);
      reply(slide);
    }, (rejection) => {
      //TODO validate and have a look at different http status codes for response
      request.log('info', rejection);
      if (co.isEmpty(rejection.message)) {
        request.log('info', rejection);
        reply(boom.notFound());
      } else
        throw rejection;
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  updateSlide: function(request, reply) {
    //NOTE shall the payload and/or response be cleaned or enhanced with values?
    slideDB.update(request.payload).then((slide) => {
      reply(slide);
    }, (rejection) => {
      //TODO validate and have a look at different http status codes for response
      if (co.isEmpty(rejection.message)) {
        request.log('info', rejection);
        reply(boom.notFound());
      } else
        throw rejection;
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  getDeck: function(request, reply) {
    deckDB.get(encodeURIComponent(request.params.id)).then((deck) => {
      reply(deck);
    }, (rejection) => {
      //TODO validate and have a look at different http status codes for response
      if (co.isEmpty(rejection.message)) {
        request.log('info', rejection);
        reply(boom.notFound());
      } else
        throw rejection;
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  getDeckTree: function(request, reply) {
    reply(boom.notImplemented);
  }
};
