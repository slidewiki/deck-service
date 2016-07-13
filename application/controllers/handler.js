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
      console.log(error);
      reply(boom.badImplementation());
    });
  },
    //TODO - objects in slides - see discussion on JIRA -
    //for example; slide title, content, speaker notes, internal embeded objects (images, videos, sound, flash, etc..)

    //use of ' and ' might make difference
    /*
    let slide = {
      id: request.params.id,
      title: '<h1> Slide #' + request.params.id + '</h1>',
      type: 'slide',
      content: '<div>'+
                '          <p style="font-size: 1.16em;">'+
                '              Donec id elit non mi porta gravida at eget metus.'+
                '          </p>'+
                '          <ul>'+
                '              <li>item 1 from slide ' + request.params.id + '</li>'+
                '              <li>item 2 from slide ' + request.params.id + '</li>'+
                '              <li>item 3 from slide ' + request.params.id + '</li>'+
                '          </ul>'+
                '          <p style="font-size: 1.2em;">'+
                '              Donec id elit non mi porta gravida at eget metus. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus.'+
                '          </p>'+
                '          <p style="text-align:center">'+
                '              <svg xmlns="http://www.w3.org/2000/svg"'+
                '                   xmlns:xlink="http://www.w3.org/1999/xlink">'+
                '                  <text x="20"  y="40"'+
                '                        style="font-family: Arial;'+
                '                               font-size  : 25;'+
                '                               stroke     : #000000;'+
                '                               fill       : #' +((1<<24)*Math.random()|0).toString(16) + ';'+
                '                              "'+
                '                        > SVG Image ' + request.params.id + '</text>'+
                '              </svg>'+
                '          </p>'+
                '      </div>',
      speakernotes: '<i>speaker notes:</i> More information on <a href="http://www.test.com" target="_blank">test.com</a>"'};

    reply(slide);
  },*/
  //----mockup:end

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
      //console.log('inserted: ', inserted);
      if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
        throw inserted;
      else{

        deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.parent_deck, 'slide');
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
        deckDB.updateContentItem(replaced, '', request.payload.parent_deck, 'slide');
        reply(replaced.value);
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
      console.log(error);
      reply(boom.badImplementation());
    });
  },
  newDeck: function(request, reply) {
    //NOTE shall the response be cleaned or enhanced with values?
    deckDB.insert(request.payload).then((inserted) => {
      if (co.isEmpty(inserted.ops) || co.isEmpty(inserted.ops[0]))
        throw inserted;
      else{ //check if a parent deck is defined, if yes, update its content items to reflect the new sub-deck
        if(typeof request.payload.parent_deck !== 'undefined')
          deckDB.insertNewContentItem(inserted.ops[0], request.payload.position, request.payload.parent_deck, 'deck');
        reply(co.rewriteID(inserted.ops[0]));
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
        deckDB.updateContentItem(replaced, '', request.payload.parent_deck, 'deck');
        reply(replaced.value);
      }
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
  },

  //decktree
  getDeckTree: function(request, reply) {
    //----mockup:start
    let deckTree;
    let deckTree1 = {
      title: 'Semantic Web', id: request.params.id, type: 'deck', children: [
          {title: 'Introduction', id: '575060ae4bc68d1000ea952b', type: 'slide'},
          {title: 'RDF Data Model', id: 67, type: 'deck',  children: [
              {title: 'Introduction', id: '57506cbd1ae1bd1000312a70', type: 'slide'},
              {title: 'Serialization', id: '575039f24bc68d1000ea9525', type: 'slide'},
              {title: 'Examples', id: '57503dc14bc68d1000ea9526', type: 'slide'}
          ]},
          {title: 'SPARQL', id: 68, type: 'deck',  children: [
              {title: 'Syntax', id: 685, type: 'deck', children: [
                  {title: 'Same Slide', id: '57505e034bc68d1000ea9527', type: 'slide'},
                  {title: 'Same Slide', id: '57505eec4bc68d1000ea952a', type: 'slide'}
              ]},
              {title: 'Examples', id: '57505e674bc68d1000ea9529', type: 'slide'}
          ]
          },
          {title: 'Conclusion', id: '574f2bbf81e34010002b7fda', type: 'slide'},
          {title: 'Future Work', id: '574f2b2881e34010002b7fd8', type: 'slide'},
          {title: 'References', id: '574f24e881e34010002b7fd4', type: 'slide'},
          {title: 'Extra1', id: '574f251081e34010002b7fd6', type: 'slide'},
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
    //should be 'deckDB.update'?
    deckDB.replace(encodeURIComponent(request.params.id).name, request.payload.name).then((replaced) => {
      //console.log('updated: ', replaced);
      if (co.isEmpty(replaced.value))
        throw replaced;
      else
        reply(replaced.value);
    }).catch((error) => {
      request.log('error', error);
      reply(boom.badImplementation());
    });
    reply({'msg': 'node name got updated. New node name is: ' + request.payload.name});
  },

  deleteDeckTreeNode: function(request, reply) {
    //todo: delete the node in DB
    reply({'msg': 'node is successfully deleted...'});
  }
};
/*        '<h1> Slide #' + request.params.id + '</h1>
                <div>
                    <p style="font-size: 1.16em;">
                        Donec id elit non mi porta gravida at eget metus. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus. Etiam porta sem malesuada magna mollis euismod. Donec sed odio dui. Donec id elit non mi porta gravida at eget metus. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus. Etiam porta sem malesuada magna mollis euismod. Donec sed odio dui. Donec id elit non mi porta gravida at eget metus.
                    </p>
                    <ul>
                        <li>item 1 from slide ' + request.params.id + '</li>
                        <li>item 2 from slide ' + request.params.id + '</li>
                        <li>item 3 from slide ' + request.params.id + '</li>
                    </ul>
                    <p style="font-size: 1.2em;">
                        Donec id elit non mi porta gravida at eget metus. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus. Etiam porta sem malesuada magna mollis euismod. Donec sed odio dui.
                    </p>
                    <p style="text-align:center">
                        <svg xmlns="http://www.w3.org/2000/svg"
                             xmlns:xlink="http://www.w3.org/1999/xlink">
                            <text x="20"  y="40"
                                  style="font-family: Arial;
                                         font-size  : 25;
                                         stroke     : #000000;
                                         fill       : #' +((1<<24)*Math.random()|0).toString(16) + ';
                                        "
                                  > SVG Image ' + request.params.id + '</text>
                        </svg>
                    </p>
                </div>
                '*/
