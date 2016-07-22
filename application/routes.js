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
      description: 'Get metadata of a deck'
    }
  });
/*
  server.route({
    method: 'POST',
    path: '/deck/new',
    handler: handlers.newDeck,
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
          position: Joi.string().alphanum().lowercase().min(0),
          language: Joi.string(),
          license: Joi.string().valid('CC0', 'CC BY', 'CC BY-SA')
        }).requiredKeys('user', 'content', 'root_deck', 'license'),
      },
      tags: ['api'],
      description: 'Create a new deck'
    }
  });


from deck model:

DECK OBJECT:
  description: {
    type: 'string'
  },
  language: {
    type: 'string'
  },
  translation: {
    type: 'object'
  },
  lastUpdate: {
    type: 'string'
  },
  revisions: {
    type: 'array',
    items: deckRevision
  },
  tags: {
    type: 'array',
    items: {
      type: 'string'
    }
  }

DECK REVISION OBJECT

title: {
  type: 'string'
},
timestamp: {
  type: 'string'
},
user: objectid,
parent: {
  type: 'object'
},
popularity: {
  type: 'number',
  minimum: 0
},
theme: {
  type: 'object',
  properties: {
    default: objectid
  }
},
transition: {
  type: 'object',
  properties: {
    default: objectid
  }
},
comment: {
  type: 'string'
},
abstract: {
  type: 'string'
},
footer: {
  type: 'object',
  properties: {
    text: {
      type: 'string'
    }
  }
},
license: {
  type: 'string',
  enum: ['CC0', 'CC BY', 'CC BY-SA']
},
isFeatured: {
  type: 'number'
},
priority: {
  type: 'number'
},
visibility: {
  type: 'boolean'
},
language: {
  type: 'string'
},
translation: {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['original', 'google', 'revised']
    },
    source: {
      type: 'object'
    }
  }
},
tags: {
  type: 'array',
  items: {
    type: 'string'
  }
},
preferences: {
  type: 'array',
  items: {
    type: 'object'
  }
},
contentItems: {
  type: 'array',
  items: contentItem
},
dataSources: {
  type: 'array',
  items: objectid
}

  //update deck
  // TODO Altered API from Alis proposal
  server.route({
    method: 'PUT',
    path: '/deck/{id}',
    handler: handlers.updateDeck,
    config: {
      validate: {
        params: {
          id: Joi.string().alphanum().lowercase()
        },
        payload: Joi.object().keys({

        }).requiredKeys(),
      },
      tags: ['api'],
      description: 'Replace a deck'
    }
  });  */

  //slides
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
    method: 'GET',
    path: '/allslide',
    handler: handlers.getAllSlides,
    config: {
      validate: {
        params: {
        },
      },
      tags: ['api'],
      description: 'Get all slide'
    }
  });

  server.route({
    method: 'PUT',
    path: '/selectedSlides',
    handler: handlers.getSelected,
    config: {
      validate: {
	payload: Joi.object().keys({
         selectedIDs: Joi.array().items(Joi.string().lowercase().alphanum().required())
         }).requiredKeys('selectedIDs')
      },
      tags: ['api'],
      description: 'Get selected slides'
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
          speakernotes: Joi.string(),
          user: Joi.string().alphanum().lowercase(),
          root_deck: Joi.string().alphanum().lowercase(),
          parent_slide: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          position: Joi.string().alphanum().lowercase().min(0),
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
          speakernotes: Joi.string(),
          user: Joi.string().alphanum().lowercase(),
          root_deck: Joi.string().alphanum().lowercase(),
          parent_slide: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(),
            revision: Joi.string().alphanum().lowercase()
          }),
          position: Joi.string().alphanum().lowercase().min(0),
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
          id: Joi.string().alphanum().lowercase()
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
            id: Joi.string().alphanum().lowercase(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.string().alphanum().lowercase()
          }),
          nodeSpec: Joi.object().keys({
            id: Joi.string().alphanum().lowercase(), //0 means it is a new node not existing
            type: Joi.string()
          }),
          user: Joi.string().alphanum().lowercase()
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
            id: Joi.string().alphanum().lowercase(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.string().alphanum().lowercase()
          }),
          name: Joi.string(),
          user: Joi.string().alphanum().lowercase()
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
            id: Joi.string().alphanum().lowercase(), //id of the root deck
            spath: Joi.string(),
            stype: Joi.string(),
            sid: Joi.string().alphanum().lowercase()
          }),
          user: Joi.string().alphanum().lowercase()
        }).requiredKeys('selector', 'user'),
      },
      tags: ['api'],
      description: 'Delete a node (slide/deck) from the deck tree'
    }
  });
};
