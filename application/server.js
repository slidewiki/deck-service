'use strict';

const hapi = require('hapi'),
  co = require('./common');

const server = new hapi.Server();

let port = (!co.isEmpty(process.env.APPLICATION_PORT)) ? process.env.APPLICATION_PORT : 3000;
let host = (!co.isEmpty(process.env.VIRTUAL_HOST)) ? process.env.VIRTUAL_HOST : server.info.host;
server.connection({
  port: port
});

module.exports = server;

let plugins = [
  require('inert'),
  require('vision'), {
    register: require('good'),
    options: {
      reporters: [{
        reporter: require('good-console'),
        events: {
          request: '*',
          response: '*',
          log: '*',
          request: '*'
        }
      }]
    }
  }, {
    register: require('hapi-swagger'),
    options: {
      host: host,
      info: {
        title: 'Deck and Slide Management API',
        description: 'Powered by node, hapi, joi, hapi-swaggered, hapi-swaggered-ui and swagger-ui',
        version: '0.1.0'
      }
    }
  }
];

server.register(plugins, (err) => {
  if (err) {
    console.error(err);
    global.process.exit();
  } else {
    server.start(() => {
      server.log('info', 'Server started at ' + server.info.uri);
      require('./routes.js')(server);
    });
  }
});
