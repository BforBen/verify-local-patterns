var basicAuth = require('basic-auth')
var config = require('../app/config.js')
var fs = require('fs')
//var marked = require('marked')
var path = require('path')
var portScanner = require('portscanner')
var prompt = require('prompt')
var request = require('sync-request')

// Variables
var releaseUrl = null

// require core and custom filters, merges to one object
// and then add the methods to nunjucks env obj
exports.addNunjucksFilters = function (env) {
  var coreFilters = require('./core_filters.js')(env)
  var customFilters = require('../app/filters.js')(env)
  var filters = Object.assign(coreFilters, customFilters)
  Object.keys(filters).forEach(function (filterName) {
    env.addFilter(filterName, filters[filterName])
  })
  return
}

/**
 * Simple basic auth middleware for use with Express 4.x.
 *
 * Based on template found at: http://www.danielstjules.com/2014/08/03/basic-auth-with-express-4/
 *
 * @example
 * app.use('/api-requiring-auth', utils.basicAuth('username', 'password'))
 *
 * @param   {string}   username Expected username
 * @param   {string}   password Expected password
 * @returns {function} Express 4 middleware requiring the given credentials
 */

exports.basicAuth = function (username, password) {
  return function (req, res, next) {
    if (!username || !password) {
      console.log('Username or password is not set.')
      return res.send('<h1>Error:</h1><p>Username or password not set. <a href="https://govuk-prototype-kit.herokuapp.com/docs/publishing-on-heroku#5-set-a-username-and-password">See guidance for setting these</a>.</p>')
    }

    var user = basicAuth(req)

    if (!user || user.name !== username || user.pass !== password) {
      res.set('WWW-Authenticate', 'Basic realm=Authorization Required')
      return res.sendStatus(401)
    }

    next()
  }
}

exports.findAvailablePort = function (app, callback) {
  var port = null

  try {
    port = Number(fs.readFileSync(path.join(__dirname, '/../.port.tmp')))
  } catch (e) {
    port = Number(process.env.PORT || config.port)
  }

  console.log('')

  // Check that default port is free, else offer to change
  portScanner.findAPortNotInUse(port, port + 50, '127.0.0.1', function (error, availablePort) {
    if (error) { throw error }
    if (port === availablePort) {
      callback(port)
    } else {
      // Default port in use - offer to change to available port
      console.error('ERROR: Port ' + port + ' in use - you may have another prototype running.\n')
      // Set up prompt settings
      prompt.colors = false
      prompt.start()
      prompt.message = ''
      prompt.delimiter = ''

      // Ask user if they want to change port
      prompt.get([{
        name: 'answer',
        description: 'Change to an available port? (y/n)',
        required: true,
        type: 'string',
        pattern: /y(es)?|no?/i,
        message: 'Please enter y or n'
      }], function (err, result) {
        if (err) { throw err }
        if (result.answer.match(/y(es)?/i)) {
          // User answers yes
          port = availablePort
          fs.writeFileSync(path.join(__dirname, '/../.port.tmp'), port)
          console.log('Changed to port ' + port)

          callback(port)
        } else {
          // User answers no - exit
          console.log('\nYou can set a new default port in server.js, or by running the server with PORT=XXXX')
          console.log("\nExit by pressing 'ctrl + c'")
          process.exit(0)
        }
      })
    }
  })
}

exports.forceHttps = function (req, res, next) {
  if (req.headers['x-forwarded-proto'] !== 'https') {
    console.log('Redirecting request to https')
    // 302 temporary - this is a feature that can be disabled
    return res.redirect(302, 'https://' + req.get('Host') + req.url)
  }
  next()
}

// Synchronously get the url for the latest release on github and store
exports.getLatestRelease = function () {
  var url = ''

  if (releaseUrl !== null) {
    // Release url already exists
    console.log('Release url cached:', releaseUrl)
    return releaseUrl
  } else {
    // Release url doesn't exist
    var options = {
      headers: {'user-agent': 'node.js'}
    }
    var gitHubUrl = 'https://api.github.com/repos/alphagov/govuk_prototype_kit/releases/latest'
    try {
      console.log('Getting latest release from github')

      var res = request('GET', gitHubUrl, options)
      var data = JSON.parse(res.getBody('utf8'))
      var zipballUrl = data['zipball_url']
      var releaseVersion = zipballUrl.split('/').pop()
      var urlStart = 'https://github.com/alphagov/govuk_prototype_kit/archive/'
      var urlEnd = '.zip'
      var zipUrl = urlStart + releaseVersion + urlEnd

      console.log('Release url is', zipUrl)
      releaseUrl = zipUrl
      url = releaseUrl
    } catch (err) {
      url = 'https://github.com/alphagov/govuk_prototype_kit/releases/latest'
      console.log("Couldn't retrieve release url")
    }
  }
  return url
}

// Matches routes
exports.matchRoutes = function (req, res) {
  var path = (req.params[0])
  res.render(path, function (err, html) {
    if (err) {
      res.render(path + '/index', function (err2, html) {
        if (err2) {
          res.status(404).send(err + '<br>' + err2)
        } else {
          res.end(html)
        }
      })
    } else {
      res.end(html)
    }
  })
}

/*exports.matchMdRoutes = function (req, res) {
  var docsPath = '/../docs/documentation/'
  if (fs.existsSync(path.join(__dirname, docsPath, req.params[0] + '.md'), 'utf8')) {
    var doc = fs.readFileSync(path.join(__dirname, docsPath, req.params[0] + '.md'), 'utf8')
    var html = marked.parse(doc)
    res.render('documentation_template', {'document': html})
    return true
  }
  return false
}*/


// Middleware - store any data sent in session, and pass it to all views

exports.autoStoreData = function (req, res, next) {
  if (!req.session.data) {
    req.session.data = {}
  }

  for (var i in req.body) {
    // any input where the name starts with _ is ignored
    if (i.indexOf('_') === 0) {
      continue
    }

    var val = req.body[i]

    // delete single unchecked checkboxes
    if (val === '_unchecked' || val === ['_unchecked']) {
      delete req.session.data[i]
      continue
    }

    // remove _unchecked from arrays
    if (Array.isArray(val)) {
      var index = val.indexOf('_unchecked')
      if (index > -1) {
        val.splice(index, 1)
      }
    }

    req.session.data[i] = val
  }

  console.log("SESSION:", req.session.data)
  console.log("QUERY:", req.query)

  // This overrides the session storage with an object in the URL
  // You must generate the URL and encode it as encodeURI to make it work
  // Example URL which overrides to Bucks: http://localhost:3000/service-patterns/parking-permit/example-service/success?sessionOverride=%7B%22council%22:%7B%22name%22:%22Buckinghamshire%20County%20Council%22,%22shortName%22:%22Buckinghamshire%22,%22parkingBoundary%22:%22Buckinghamshire%22,%22limitByHousehold%22:true,%22permitMax%22:2,%22permitsCosts%22:%5B52%5D,%22sixmonth%22:true,%22payOnline%22:true,%22testChangeAddress%22:false,%22userChooseStartDate%22:true,%22permitWait%22:0,%22tempPermit%22:true,%22string%22:%22buckinghamshire%22,%22testv5cScan%22:false,%22testv5cnumber%22:false,%22DVLAAPIenforcement%22:false,%22ctloa1%22:true%7D%7D

  if(req.query.sessionOverride){
    // for(var key in req.query.sessionOverride){
    var sessionOverride =  JSON.parse(req.query.sessionOverride)

    var sessionAndQuery = Object.assign(req.session.data, sessionOverride)
    console.log("sessionAndQuery", sessionAndQuery)

    // send session data to all views
    for (var j in sessionAndQuery) {
      res.locals[j] = sessionAndQuery[j]
    }
  }else{
    // send session data to all views
    for (var j in req.session.data) {
      res.locals[j] = req.session.data[j]
    }
  }


  next()
}
