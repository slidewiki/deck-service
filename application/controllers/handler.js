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
    //----mockup:start
    let deckTree;
    let deckTree1 = {
      title: 'Semantic Web', id: request.params.id, type: 'deck', children: [
          {title: 'Introduction', id: 66, type: 'slide'},
          {title: 'RDF Data Model', id: 67, type: 'deck',  children: [
              {title: 'Introduction', id: 671, type: 'slide'},
              {title: 'Serialization', id: 673, type: 'slide'},
              {title: 'Examples', id: 678, type: 'slide'}
          ]},
          {title: 'SPARQL', id: 68, type: 'deck',  children: [
              {title: 'Syntax', id: 685, type: 'deck', children: [
                  {title: 'Same Slide', id: 691, type: 'slide'},
                  {title: 'Same Slide', id: 691, type: 'slide'}
              ]},
              {title: 'Examples', id: 686, type: 'slide'}
          ]
          },
          {title: 'Conclusion', id: 78, type: 'slide'},
          {title: 'Future Work', id: 99, type: 'slide'},
          {title: 'References', id: 79, type: 'slide'},
          {title: 'Extra1', id: 739, type: 'slide'},
          {title: 'Extra2', id: 789, type: 'slide'},
          {title: 'Extra3', id: 799, type: 'slide'}
      ]
    };
    let deckTree2 = {
      title: 'Example Deck', id: 91, type: 'deck', children: [
          {title: 'Slide 1', id: 911, type: 'slide'},
          {title: 'Slide 2', id: 912, type: 'slide'}
      ]
    };
    if(parseInt(request.params.id) === 91){
      deckTree = deckTree2;
    }else{
      deckTree = deckTree1;
    }
    //----mockup:end
    reply(deckTree);
  },

  createDeckTreeNode: function(request, reply) {
    //----mockup:start
    let node = {};
    let rnd = Math.round(Math.random()*800) + 1;
    if(request.payload.nodeSpec.type === 'slide'){
      if(parseInt(request.payload.nodeSpec.id)){
        //it means it is an existing node, we should retrieve the details then
        node = {title: 'Existing Slide', id: 11, type: 'slide'};
      }else{
        //need to make a new slide
        node = {title: 'New Slide', id: rnd, type: 'slide'};
      }
    }else{
      if(parseInt(request.payload.nodeSpec.id)){
        //it means it is an existing node
        node = {title: 'Existing Deck', id: 53, type: 'deck',  children: [
               {title: 'Syntax', id: 685, type: 'slide'},
               {title: 'Slide34', id: 691, type: 'slide'}
        ]};
      }else{
        //need to make a new slide
        node = {title: 'New Deck', id: rnd, type: 'deck',  children: [
               {title: 'New Slide', id: rnd, type: 'slide'}
        ]};
      }
    }
    //----mockup:end
    reply(node);
  },

  renameDeckTreeNode: function(request, reply) {
    //todo: update the name in DB
    reply({'msg': 'node name got updated. New node name is: ' + request.payload.name});
  },

  deleteDeckTreeNode: function(request, reply) {
    //todo: delete the node in DB
    reply({'msg': 'node is successfully deleted...'});
  }
};
