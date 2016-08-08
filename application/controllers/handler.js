/*
Handles the requests by executing stuff and replying to the client. Uses promises to get stuff done.
*/

'use strict';

const boom = require('boom'),
  slideDB = require('../database/slideDatabase'),
  deckDB = require('../database/deckDatabase'),
  co = require('../common');

let self = module.exports = {
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

  //Get All Slides from database
  getAllSlides: function(request, reply) {
    slideDB.getAllFromCollection()
      .then((slides) => {
        slides.forEach((slide) => {
          co.rewriteID(slide);
          //activity.author = authorsMap.get(activity.user_id);//insert author data
        });

        let jsonReply = JSON.stringify(slides);
        reply(jsonReply);

      }).catch((error) => {
        request.log('error', error);
        reply(boom.badImplementation());
      });
  },

  newSlide: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    slideDB.insert(request.payload).then((inserted) => {
      if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
        throw inserted;
      else{
        deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.root_deck, 'slide');
        reply(co.rewriteID(inserted.ops[0]));
      }
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
      else{
        console.log(replaced.value._id);

        slideDB.get(replaced.value._id).then((newSlide) => {
          console.log(newSlide);
          console.log(request.payload.root_deck);
          deckDB.updateContentItem(newSlide, '', request.payload.root_deck, 'slide');
        });

        reply(replaced.value);
      }
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  revertSlideRevision: function(request, reply) {
    slideDB.get(encodeURIComponent(request.params.id), request.payload).then((slide) => {
      if (co.isEmpty(slide))
        throw slide;
      else{
        deckDB.updateContentItem(slide, parseInt(request.payload.revision_id), slide.deck, 'slide');
        reply(slide);
      }
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
  newDeck: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    deckDB.insert(request.payload).then((inserted) => {
      if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
        throw inserted;
      else{
        //create a new slide inside the new deck
        let newSlide = {
          'title': 'New slide',
          'content': '',
          'language': 'en',
          'license': 'CC0',
          //NOTE user_id should be retrieved from the frontend
          'user': '1111',
          'root_deck': String(inserted.ops[0]._id),
          'position' : 1
        };
        slideDB.insert(newSlide)
        .then((insertedSlide) => {
          insertedSlide.ops[0].id = insertedSlide.ops[0]._id;
          deckDB.insertNewContentItem(insertedSlide.ops[0], 0, newSlide.root_deck, 'slide')
          .then((insertedContentItem) => {
            if(typeof request.payload.root_deck !== 'undefined')
              deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.root_deck, 'deck');
            reply(co.rewriteID(inserted.ops[0]));
          });

        });
        //check if a root deck is defined, if yes, update its content items to reflect the new sub-deck

      }
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  updateDeck: function(request, reply) {
    //NOTE shall the payload and/or response be cleaned or enhanced with values?
    //or should be deckDB.replace?
    deckDB.update(encodeURIComponent(request.params.id), request.payload).then((replaced) => {
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

  updateDeckRevision: function(request, reply) {
    //NOTE shall the payload and/or response be cleaned or enhanced with values?
    deckDB.replace(encodeURIComponent(request.params.id), request.payload).then((replaced) => {
      if (co.isEmpty(replaced.value))
        throw replaced;
      else{
        if(request.payload.root_deck){
          deckDB.get(replaced.value._id).then((newDeck) => {
            deckDB.updateContentItem(newDeck, '', request.payload.root_deck, 'deck');
          });
        }
        reply(replaced.value);
      }
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  revertDeckRevision: function(request, reply) {
    deckDB.revert(encodeURIComponent(request.params.id), request.payload).then((reverted) => {
      if (co.isEmpty(reverted))
        throw reverted;
      else{
        if(reverted.value.deck !== null){
          deckDB.updateContentItem(reverted.value, parseInt(request.payload.revision_id), reverted.value.deck, 'deck');
        }
        reply(reverted);
      }
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  //decktree
  getDeckTree: function(request, reply) {
    deckDB.getDeckTreeFromDB(request.params.id)
    .then((deckTree) => {
      reply(deckTree);
    });
  },

  createDeckTreeNode: function(request, reply) {
    //----mockup:start
    let node = {};
    //let rnd = Math.round(Math.random()*800) + 1;

    if(request.payload.nodeSpec.type === 'slide'){
      if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
        //it means it is an existing node, we should retrieve the details then
        //NOTE get existing slide from DB and create node object in deck tree
        //node = {title: 'Existing Slide', id: 11, type: 'slide'};

        module.exports.getSlide({'params' : {'id' : request.payload.nodeSpec.id}}, (slide) => {
          node = {title: slide.title, id: request.payload.nodeSpec.id, type: 'slide'};
          reply(node);
        });

      }else{
        //need to make a new slide
        let spath = request.payload.selector.spath;
        let spathArray = spath.split(';');
        let parentID, parentPosition, slidePosition;
        if(spathArray.length > 1){

          let parentArrayPath = spathArray[spathArray.length-2].split(':');
          parentID = parentArrayPath[0];
          parentPosition = parentArrayPath[1];

        }
        else{
          parentID = request.payload.selector.id;
        }

        let slideArrayPath = spathArray[spathArray.length-1].split(':');
        slidePosition = slideArrayPath[1]+1;
        //NOTE we should call /slide/new
        let slide = {
          'title': 'New slide', //NOTE add title
          'content': '',
          'language': 'en',
          'license': 'CC0',
          //NOTE user_id should be retrieved from the frontend
          'user': request.payload.user,
          'root_deck': parentID,
          'position' : slidePosition
        };
        //NOTE update positions accordingly
        module.exports.newSlide({'payload' : slide}, (createdSlide) => {
          node = {title: createdSlide.revisions[0].title, id: createdSlide.id+'-'+createdSlide.revisions[0].id, type: 'slide'};
          //we have to return from the callback, else empty node is returned because it is updated asynchronously
          reply(node);
        });


      }
    }else{
      if(request.payload.nodeSpec.id && request.payload.nodeSpec.id !== '0'){
        //it means it is an existing node
        // node = {title: 'Existing Deck', id: 53, type: 'deck',  children: [
        //        {title: 'Syntax', id: 685, type: 'slide'},
        //        {title: 'Slide34', id: 691, type: 'slide'}
        // ]};
        module.exports.getDeck({'params': {'id' : request.payload.nodeSpec.id}}, (deck) => {
          //we have to return from the callback, else empty node is returned because it is updated asynchronously
          module.exports.getDeckTree({'params': {'id' : deck.id}}, (deckTree) => {
            reply(deckTree);
          });

        });


      }else{
        //NOTE create the new deck and populate the node object
        // node = {title: 'New Deck', id: rnd, type: 'deck',  children: [
        //        {title: 'New Slide', id: rnd, type: 'slide'}
        // ]};

        //need to make a new deck
        let spath = request.payload.selector.spath;
        let spathArray = spath.split(';');
        let parentID, parentPosition, deckPosition;
        if(spathArray.length > 1){

          let parentArrayPath = spathArray[spathArray.length-2].split(':');
          parentID = parentArrayPath[0];
          parentPosition = parentArrayPath[1];

        }
        else{
          parentID = request.payload.selector.id;
        }

        let deckArrayPath = spathArray[spathArray.length-1].split(':');
        deckPosition = deckArrayPath[1]+1;
        //NOTE we should call /slide/new
        let deck = {
          'description': '',
          'title': 'New deck', //NOTE add title
          'content': '',
          'language': 'en',
          'license': 'CC0',
          //NOTE user_id should be retrieved from the frontend
          'user': request.payload.user,
          'root_deck': parentID,
          'position' : deckPosition
        };

        //NOTE update positions accordingly
        module.exports.newDeck({'payload' : deck}, (createdDeck) => {
          //we have to return from the callback, else empty node is returned because it is updated asynchronously
          module.exports.getDeckTree({'params': {'id' : createdDeck.id}}, (deckTree) => {
            reply(deckTree);
          });

        });
      }
    }
    //----mockup:end
    //reply(node);
  },

  renameDeckTreeNode: function(request, reply) {
    //NOTE check if it is deck or slide
    if(request.payload.selector.stype === 'deck'){
      deckDB.rename(encodeURIComponent(request.payload.selector.sid), request.payload.name).then((renamed) => {
        if (co.isEmpty(renamed.value))
          throw renamed;
        else
          reply(renamed.value);
      }).catch((error) => {
        request.log('error', error);
        reply(boom.badImplementation());
      });
    }else {
      slideDB.rename(encodeURIComponent(request.payload.selector.sid), request.payload.name).then((renamed) => {
        if (co.isEmpty(renamed.value))
          throw renamed;
        else
          reply(renamed.value);
      }).catch((error) => {
        request.log('error', error);
        reply(boom.badImplementation());
      });
    }

    //reply({'msg': 'node name got updated. New node name is: ' + request.payload.name});
  },

  deleteDeckTreeNode: function(request, reply) {
    //NOTE no removal in the DB, just unlink from content items, and update the positions of the other elements
    console.log(request);
    let spath = request.payload.selector.spath;
    let spathArray = spath.split(';');
    let parentID, parentPosition, itemPosition;
    if(spathArray.length > 1){

      let parentArrayPath = spathArray[spathArray.length-2].split(':');
      parentID = parentArrayPath[0];
      parentPosition = parentArrayPath[1];

    }
    else{
      parentID = request.payload.selector.id;
    }

    let itemArrayPath = spathArray[spathArray.length-1].split(':');
    itemPosition = itemArrayPath[1];
    //NOTE removes item in given position -- do we have to validate with sid ?
    deckDB.removeContentItem(itemPosition, parentID)
    .then((removed) => {
      reply(removed);
    });
  },

  getFlatSlides: function(request, reply){
    deckDB.getFlatSlidesFromDB(request.params.id)
    .then((deckTree) => {
      reply(deckTree);
    });
  }
};
