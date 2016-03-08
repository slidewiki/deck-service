'use strict';

const hapi = require('hapi'),
  co = require('./common');

const server = new hapi.Server();
let port2 = 3000;
if (!co.isEmpty(process.env.APPLICATION_PORT)) {
  port2 = process.env.APPLICATION_PORT;
  console.log('Using port ' + port2 + ' as application port.');
}
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
