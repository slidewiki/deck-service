/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/

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
      console.log('ERROR: ', error);
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  newSlide: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    slideDB.insert(request.payload).then((inserted) => {
      //console.log('inserted: ', inserted);
      if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
        throw inserted;
      else
        reply(co.rewriteID(inserted.ops[0]));
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  updateSlide: function(request, reply) {
    //NOTE shall the payload and/or response be cleaned or enhanced with values?
    slideDB.replace(encodeURIComponent(request.params.id), request.payload).then((replaced) => {
      //console.log('updated: ', replaced);
      if (co.isEmpty(replaced.value))
        throw replaced;
      else
        reply(replaced.value);
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  getDeck: function(request, reply) {
    deckDB.get(encodeURIComponent(request.params.id)).then((deck) => {
      if (co.isEmpty(deck))
        reply(boom.notFound());
      else
        reply(co.rewriteID(deck));
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  getDeckTree: function(request, reply) {
    reply(boom.notImplemented);
  }
};
