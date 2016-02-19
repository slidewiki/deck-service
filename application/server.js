'use strict';

const hapi = require('hapi');
const myRoutes = require('./routes.js');
const co = require('./common');

const server = new hapi.Server();
let port2 = 3000;
if (!co.isEmpty(process.env.APPLICATION_PORT))
  port2 = process.env.APPLICATION_PORT;
server.connection({
  //  host: 'localhost',
  port: port2
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
          response: '*',
          log: '*'
        }
      }]
    }
  }, {
    register: require('hapi-swagger'),
    options: {
      info: {
        title: 'Example API',
        description: 'Powered by node, hapi, joi, hapi-swaggered, hapi-swaggered-ui and swagger-ui',
        version: '1.0'
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
      myRoutes(server);
    });
  }
});
