'use strict';

const helper = require('./helper'),
  oid = require('mongodb').ObjectID,
  deckModel = require('../models/deck.js');

module.exports = {
  get: function(identifier) {
    return helper.connectToDatabase()
      .then((db) => db.collection('decks'))
      .then((col) => col.findOne({
        _id: oid(identifier)
      }));
  },

  insert: function(deck) {
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      let valid = false;
      const convertedDeck = convertToNewDeck(deck);
      try {
        valid = deckModel(convertedDeck);
        if (!valid) {
          return deckModel.errors;
        }
        return col.insertOne(convertedDeck);
      } catch (e) {
        console.log('validation failed', e);
      }
      return;
    });
  },

  update: function(deck) {    //when no new revision is needed..?
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => col.findOneAndUpdate({
      _id: deck.id
    }, deck));
  },

  replace: function(id, deck) {
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      return col.findOne({_id: oid(id)})
        .then((existingDeck) => {
          const maxRevisionId = existingDeck.revisions.reduce((prev, curr) => {
            if (curr.id > prev)
              return curr.id;

            return prev;
          }, 1);
          let valid = false;
          const newRevisionId = maxRevisionId+1;
          //must get previously active revision and copy content items to new revision
          let activeRevisionIndex = getActiveRevision(existingDeck);
          let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
          const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items);
          try {
            valid = deckModel(deckWithNewRevision);

            if (!valid) {
              return deckModel.errors;
            }

            return col.findOneAndUpdate({
              _id: oid(id)
            }, {$set: {active : newRevisionId}, $push: { revisions: deckWithNewRevision.revisions[0] } });
          } catch (e) {
            console.log('validation failed', e);
          }
          return;
        });
    });
  },

  insertNewContentItem: function(citem, position, root_deck, ckind){
    helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      col.findOne({_id: oid(root_deck)})
      .then((existingDeck) => {
        col.findOne({_id: oid(root_deck)}, {revisions : {$elemMatch: {id: existingDeck.active}}})
        .then((activeRevision) => col.findOneAndUpdate({
          _id: oid(root_deck),  revisions : {$elemMatch: {id: existingDeck.active}}  },
          {
            $push: {
              'revisions.$.contentItems': {
                order: getOrder(activeRevision)+1,
                kind: ckind,
                ref : {
                  id: String(citem.id),
                  revision:1
                }
              }
            }
          },
          function(err, result) { console.log(err); console.log(result);}
        ));
      });
    });
  },

  updateContentItem: function(citem, position, root_deck, ckind){
    helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      col.findOne({_id: oid(root_deck)})
      .then((existingDeck) => {
        const newRevId = getNewRevisionID(citem);
        for(let i = 0; i < existingDeck.revisions.length; i++) {
          if(existingDeck.revisions[i].id === existingDeck.active) {
            for(let j = 0; j < existingDeck.revisions[i].contentItems.length; j++) {
              if(existingDeck.revisions[i].contentItems[j].ref.id === String(citem._id)) {
                existingDeck.revisions[i].contentItems[j].ref.revision = newRevId;
              }
              else continue;
            }
          }
          else continue;
        }
        col.save(existingDeck);
      });
    });
  },

  revert: function(deck_id, deck){
    //console.log(deck);
    return helper.connectToDatabase()
    .then((db) => db.collection('decks'))
    .then((col) => {
      return col.findOneAndUpdate({_id: oid(deck_id)}, {'$set' : {'active' : deck.revision_id}});

    });
  }

};

function getActiveRevision(deck){
  for(let i = 0; i < deck.revisions.length; i++) {
    if(deck.revisions[i].id === deck.active) {
      return i;
    }
    else continue;
  }
  return -1;
}

function getNewRevisionID(citem){

  if(citem.revisions.length > 0)
    return Math.max.apply(
      Math,citem.revisions.map(
        function(o){
          return o.id;
        }
      )
    );
  else return 0;
}

//returns the max order of appearance (i.e., position) of a content item inside a deck, or 0 if it is empty
function getOrder(activeRevision){
  if(activeRevision.revisions[0].contentItems.length > 0){
    return Math.max.apply(
      Math,activeRevision.revisions[0].contentItems.map(
        function(o){
          return o.order;
        }
      )
    );
  }
  else return 0;
}

function convertDeck(deck) {
  let now = new Date();
  return {
    user: deck.user,
    deck: deck.root_deck,
    timestamp: now,
    lastUpdate: now,
    license: deck.license,
    revisions: [{
      title: deck.title,
      timestamp: now,
      user: deck.user,
      visibility: false,
      contentItems: deck.content_items
    }]
  };
}

function convertToNewDeck(deck){
  let now = new Date();
  const result = {
    user: deck.user,
    deck: deck.root_deck,
    timestamp: now.toISOString(),
    language: deck.language,
    description: deck.description,
    translation: deck.translation,
    lastUpdate: now.toISOString(),
    tags: deck.tags,
    active: 1,
    revisions: [{
      id: 1,
      title: deck.title,
      timestamp: now.toISOString(),
      user: deck.user,
      license: deck.license,
      parent: deck.parent_deck,
      contentItems: []
    }]
  };
  //console.log('from', slide, 'to', result);
  return result;
}

function convertDeckWithNewRevision(deck, newRevisionId, content_items) {
  let now = new Date();
  const result = {
    user: deck.user,
    deck: deck.root_deck,
    timestamp: now.toISOString(),
    language: deck.language,
    revisions: [{
      id: newRevisionId,
      timestamp: now.toISOString(),
      user: deck.user,
      license: deck.license,
      title: deck.title,
      parent: deck.parent_deck,
      contentItems: content_items
    }]
  };
  //console.log('from', slide, 'to', result);
  return result;
}
