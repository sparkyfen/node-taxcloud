'use strict';

var builder = require('xmlbuilder');
var validator = require('validator');
var request = require('request').defaults({headers: {'Content-Type': 'text/xml'}});
var parseString = require('xml2js').parseString;

function _isAddress(addr) {
  if(validator.isNull(addr.address1)) {
    return false;
  }
  if(validator.isNull(addr.city)) {
    return false;
  }
  if(validator.isNull(addr.state) || !validator.isState(addr.state)) {
    return false;
  }
  if(validator.isNull(addr.zipcode) && !validator.isZipCode(addr.zipcode, 'US')) {
    return false;
  }
  return true;
}

function _addressBuilder(address, type) {
  if(typeof(address.zipcode) !== 'string') {
    address.zipcode = address.zipcode.toString();
  }
  var addressBuilder = builder.create('tax:' + type)
  .ele('tax:Address1', address.address1).up()
  .ele('tax:Address2', address.address2 ? address.address2 : null).up()
  .ele('tax:City', address.city).up()
  .ele('tax:State', address.state).up()
  .ele('tax:Zip5', address.zipcode.split('-')[0]).up()
  .ele('tax:Zip4', address.zipcode.split('-')[1]);
  return addressBuilder;
}

exports.initialize = function (apiLoginId, apiKey, uspsUserID) {
  this.apiLoginId = apiLoginId;
  this.apiKey = apiKey;
  this.uspsUserId = uspsUserID;
  this.url = 'https://api.taxcloud.net/1.0/TaxCloud.asmx';
};

exports.ping = function(callback) {
  var _self = this;
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:Ping').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/Ping"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var status = result['soap:Envelope']['soap:Body'][0]['PingResponse'][0]['PingResult'][0]['ResponseType'][0];
      if(status === 'OK') {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  });
};

exports.lookup = function (customerId, cart, source, destination, callback) {
  var _self = this;
  if(validator.isNull(customerId)) {
    return callback('Customer id is missing.');
  }
  if(typeof(customerId) !== 'string') {
    return callback('Customer id must be a string.');
  }
  if(!cart instanceof Object) {
    return callback('Cart must be an object');
  }
  if(validator.isNull(cart.id)) {
    return callback('Missing cart id.');
  }
  if(!source instanceof Object) {
    return callback('Source must be an object');
  }
  if(!_isAddress(source)) {
    return callback('Source address object is invalid.');
  }
  source.state = source.state.toUpperCase();
  if(!destination instanceof Object) {
    return callback('Destination must be an object');
  }
  if(!_isAddress(destination)) {
    return callback('Destination address object is invalid.');
  }
  destination.state = destination.state.toUpperCase();
  if(!(cart.items instanceof Array)) {
    return callback('Cart items must be an array.');
  }
  if(cart.items.length < 1) {
    return callback('Cart items list must contain at least 1 item.');
  }
  if(cart.items.length > 100) {
    return callback('The maximum items in a cart is 100.');
  }
  var cartItems = builder.create('tax:cartItems');
  for (var i = 0; i < cart.items.length; i++) {
    var item = cart.items[i];
    if(typeof(item.tic) !== 'string') {
      return callback('An item tic value must be a string.');
    }
    if(!validator.isTic(item.tic)) {
      return callback('An item tic value is invalid.');
    }
    if(!validator.isFloat(item.price)) {
      return callback('An item price value is not a float.');
    }
    item.price = validator.toFloat(item.price);
    if(!validator.isInt(item.quantity)) {
      return callback('An item quantity value is not an integer.');
    }
    item.quantity = validator.toInt(item.quantity);
    cartItems.ele('tax:CartItem').ele('tax:Index', i).up().ele('tax:ItemID', item.id).up().ele('tax:TIC', item.tic).up().ele('tax:Price', item.price).up().ele('tax:Qty', item.quantity);
  }
  var sourceBuilder = _addressBuilder(source, 'origin');
  var destinationBuilder = _addressBuilder(destination, 'destination');
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:Lookup').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).up()
  .ele('tax:customerID', customerId).up()
  .ele('tax:cartID', cart.id).up().importXMLBuilder(cartItems.doc()).importXMLBuilder(sourceBuilder.doc()).importXMLBuilder(destinationBuilder.doc()).end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/Lookup"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var lookupResult = result['soap:Envelope']['soap:Body'][0]['LookupResponse'][0]['LookupResult'][0];
      if(lookupResult['ResponseType'][0] === 'OK') {
        var cartId = lookupResult['CartID'][0];
        var items = lookupResult['CartItemsResponse'][0]['CartItemResponse'].map(function (item) {
          return item['TaxAmount'][0];
        });
        return callback(null, {id: cartId, items: items});
      } else {
        return callback(lookupResult['Messages'][0]);
      }
    });
  });
};

exports.authorize = function (customerId, cartId, orderId, dateAuthorized, callback) {
  var _self = this;
  if(validator.isNull(customerId)) {
    return callback('Customer id is missing.');
  }
  if(typeof(customerId) !== 'string') {
    return callback('Customer id must be a string.');
  }
  if(validator.isNull(cartId)) {
    return callback('Cart id is missing.');
  }
  if(typeof(cartId) !== 'string') {
    return callback('Cart id must be a string.');
  }
  if(validator.isNull(orderId)) {
    return callback('Cart id is missing.');
  }
  if(typeof(orderId) !== 'string') {
    return callback('Cart id must be a string.');
  }
  if(validator.isNull(dateAuthorized)) {
    return callback('Date authorized is missing.');
  }
  if(typeof(dateAuthorized) !== 'string') {
    return callback('Date authorized must be a string.');
  }
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:Authorized').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).up()
  .ele('tax:customerID', customerId).up()
  .ele('tax:cartID', cartId).up()
  .ele('tax:orderID', orderId).up()
  .ele('tax:dateAuthorized', dateAuthorized).up().end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/Authorized"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var status = result['soap:Envelope']['soap:Body'][0]['AuthorizedResponse'][0]['AuthorizedResult'][0]['ResponseType'][0];
      if(status === 'OK') {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  });
};

exports.capture = function (orderId, callback) {
  var _self = this;
  if(validator.isNull(orderId)) {
    return callback('Order id is missing.');
  }
  if(typeof(orderId) !== 'string') {
    return callback('Order id must be a string.');
  }
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:Authorized').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).up()
  .ele('tax:orderID', orderId).up()
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/Captured"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var status = result['soap:Envelope']['soap:Body'][0]['CapturedResponse'][0]['CapturedResult'][0]['ResponseType'][0];
      if(status === 'OK') {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  });
};

exports.authorizeWithCapture = function (customerId, cartId, orderId, dateAuthorized, dateCaptured, callback) {
  var _self = this;
  if(validator.isNull(customerId)) {
    return callback('Customer id is missing.');
  }
  if(typeof(customerId) !== 'string') {
    return callback('Customer id must be a string.');
  }
  if(validator.isNull(cartId)) {
    return callback('Cart id is missing.');
  }
  if(typeof(cartId) !== 'string') {
    return callback('Cart id must be a string.');
  }
  if(validator.isNull(orderId)) {
    return callback('Order id is missing.');
  }
  if(typeof(orderId) !== 'string') {
    return callback('Order id must be a string.');
  }
  if(validator.isNull(dateAuthorized)) {
    return callback('Date authorized is missing.');
  }
  if(typeof(dateAuthorized) !== 'string') {
    return callback('Date authorized must be a string.');
  }
  if(validator.isNull(dateCaptured)) {
    return callback('Date captured is missing.');
  }
  if(typeof(dateCaptured) !== 'string') {
    return callback('Date captured must be a string.');
  }
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:AuthorizedWithCaptured').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).up()
  .ele('tax:customerID', customerId).up()
  .ele('tax:cartID', cartId).up()
  .ele('tax:orderID', orderId).up()
  .ele('tax:dateAuthorized', dateAuthorized)
  .ele('tax:dateCaptured', dateCaptured).up().end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/AuthorizedWithCaptured"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var status = result['soap:Envelope']['soap:Body'][0]['AuthorizedWithCaptureResponse'][0]['AuthorizedWithCaptureResult'][0]['ResponseType'][0];
      if(status === 'OK') {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  });
};

exports.returned = function (orderId, cartItems, returnedDate, callback) {
  var _self = this;
  if(validator.isNull(orderId)) {
    return callback('Order id is missing.');
  }
  if(typeof(orderId) !== 'string') {
    return callback('Order id must be a string.');
  }
  if(validator.isNull(returnedDate)) {
    return callback('Returned date is missing.');
  }
  if(typeof(returnedDate) !== 'string') {
    return callback('Returned date must be a string.');
  }
  if(!(cartItems instanceof Array)) {
    return callback('Cart items must be an array.');
  }
  if(cartItems.length < 1) {
    return callback('Cart items list must contain at least 1 item.');
  }
  if(cartItems.length > 100) {
    return callback('The maximum items in a cart is 100.');
  }
  var cartItemsDoc = builder.create('tax:cartItems');
  for (var i = 0; i < cartItems.length; i++) {
    var item = cartItems[i];
    if(typeof(item.tic) !== 'string') {
      return callback('An item tic value must be a string.');
    }
    if(!validator.isTic(item.tic)) {
      return callback('An item tic value is invalid.');
    }
    if(!validator.isFloat(item.price)) {
      return callback('An item price value is not a float.');
    }
    item.price = validator.toFloat(item.price);
    if(!validator.isInt(item.quantity)) {
      return callback('An item quantity value is not an integer.');
    }
    item.quantity = validator.toInt(item.quantity);
    cartItemsDoc.ele('tax:CartItem').ele('tax:Index', i).up().ele('tax:ItemID', item.id).up().ele('tax:TIC', item.tic).up().ele('tax:Price', item.price).up().ele('tax:Qty', item.quantity);
  }
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:Returned').ele('tax:apiLoginID', this.apiLoginId).up()
  .ele('tax:apiKey', this.apiKey).up()
  .ele('tax:orderID', orderId).up()
  .ele('tax:returnedDate', returnedDate).up().importXMLBuilder(cartItemsDoc.doc()).end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/Returned"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var status = result['soap:Envelope']['soap:Body'][0]['ReturnedResponse'][0]['ReturnedResult'][0]['ResponseType'][0];
      if(status === 'OK') {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  });
};

exports.getTics = function (callback) {
  request('https://taxcloud.net/tic/json/', function (err, resp, body) {
    if(err) {
      return callback(err);
    }
    if(resp.statusCode !== 200) {
      return callback(body);
    }
    body = JSON.parse(body);
    var ticList = body['tic_list'].map(function (tic) {
      return tic.tic;
    });
    return callback(null, ticList);
  });
};

exports.getTicList = function (callback) {
  this.getTics(function (error, tics) {
    if(error) {
      return callback(error);
    }
    var ticIds = tics.map(function (tic) {
      return tic.id;
    });
    var childrenIds = tics.map(function (tic) {
      if(!tic.children) {
        return;
      }
      return tic.children.map(function (child) {
        return child.tic.id;
      });
    });
    childrenIds = childrenIds.filter(function (n) {return n !== undefined;});
    childrenIds = childrenIds.reduce(function (a, b) {
      return a.concat(b);
    });
    ticIds = ticIds.concat(childrenIds);
    ticIds.sort(function (a, b) {
      return a - b;
    });
    return callback(null, ticIds);
  });
};

exports.verifyAddress = function(addr, callback) {
  var _self = this;
  if(!_isAddress(addr)) {
    return callback('Address object is invalid.');
  }
  if(typeof(addr.zipcode) !== 'string') {
    addr.zipcode = addr.zipcode.toString();
  }
  var body = builder.create('soapenv:Envelope', {headless: true}).att('xmlns:soapenv', 'http://schemas.xmlsoap.org/soap/envelope/').att('xmlns:tax', 'http://taxcloud.net')
  .ele('soapenv:Header').up()
  .ele('soapenv:Body').ele('tax:VerifyAddress').ele('tax:uspsUserID', this.uspsUserId).up()
  .ele('tax:address1', addr.address1).up()
  .ele('tax:address2', addr.address2 ? addr.address2 : null).up()
  .ele('tax:city', addr.city).up()
  .ele('tax:state', addr.state).up()
  .ele('tax:zip5', addr.zipcode.split('-')[0]).up()
  .ele('tax:zip4', addr.zipcode.split('-')[1]).end({pretty: false});
  request.post({
    url: _self.url,
    body: body,
    headers: {
      'SOAPAction': '"http://taxcloud.net/VerifyAddress"',
      'Content-Length': body.length
    }
  }, function (error, resp, xml) {
    if(error) {
      return callback(error);
    }
    if(resp.statusCode !== 200) {
      return callback(xml);
    }
    parseString(xml, function (err, result) {
      if(error) {
        return callback(error);
      }
      var addressResult = result['soap:Envelope']['soap:Body'][0]['VerifyAddressResponse'][0]['VerifyAddressResult'][0];
      if(addressResult['ErrNumber'][0] !== '0') {
        return callback(addressResult['ErrDescription'][0]);
      }
      var newAddr = {
        address1: addressResult['Address1'][0],
        address2: addressResult['Address2'] ? addressResult['Address2'][0] : null,
        city: addressResult['City'][0],
        state: addressResult['State'][0],
        zipcode: addressResult['Zip5'][0] + '-' + addressResult['Zip4'][0]
      };
      return callback(null, newAddr);
    });
  });
};

validator.extend('isState', function (str) {
  var states = Object.freeze([{ name: 'ALABAMA', abbreviation: 'AL'}, { name: 'ALASKA', abbreviation: 'AK'}, { name: 'AMERICAN SAMOA', abbreviation: 'AS'}, { name: 'ARIZONA', abbreviation: 'AZ'}, { name: 'ARKANSAS', abbreviation: 'AR'}, { name: 'CALIFORNIA', abbreviation: 'CA'}, { name: 'COLORADO', abbreviation: 'CO'}, { name: 'CONNECTICUT', abbreviation: 'CT'}, { name: 'DELAWARE', abbreviation: 'DE'}, { name: 'DISTRICT OF COLUMBIA', abbreviation: 'DC'}, { name: 'FEDERATED STATES OF MICRONESIA', abbreviation: 'FM'}, { name: 'FLORIDA', abbreviation: 'FL'}, { name: 'GEORGIA', abbreviation: 'GA'}, { name: 'GUAM', abbreviation: 'GU'}, { name: 'HAWAII', abbreviation: 'HI'}, { name: 'IDAHO', abbreviation: 'ID'}, { name: 'ILLINOIS', abbreviation: 'IL'}, { name: 'INDIANA', abbreviation: 'IN'}, { name: 'IOWA', abbreviation: 'IA'}, { name: 'KANSAS', abbreviation: 'KS'}, { name: 'KENTUCKY', abbreviation: 'KY'}, { name: 'LOUISIANA', abbreviation: 'LA'}, { name: 'MAINE', abbreviation: 'ME'}, { name: 'MARSHALL ISLANDS', abbreviation: 'MH'}, { name: 'MARYLAND', abbreviation: 'MD'}, { name: 'MASSACHUSETTS', abbreviation: 'MA'}, { name: 'MICHIGAN', abbreviation: 'MI'}, { name: 'MINNESOTA', abbreviation: 'MN'}, { name: 'MISSISSIPPI', abbreviation: 'MS'}, { name: 'MISSOURI', abbreviation: 'MO'}, { name: 'MONTANA', abbreviation: 'MT'}, { name: 'NEBRASKA', abbreviation: 'NE'}, { name: 'NEVADA', abbreviation: 'NV'}, { name: 'NEW HAMPSHIRE', abbreviation: 'NH'}, { name: 'NEW JERSEY', abbreviation: 'NJ'}, { name: 'NEW MEXICO', abbreviation: 'NM'}, { name: 'NEW YORK', abbreviation: 'NY'}, { name: 'NORTH CAROLINA', abbreviation: 'NC'}, { name: 'NORTH DAKOTA', abbreviation: 'ND'}, { name: 'NORTHERN MARIANA ISLANDS', abbreviation: 'MP'}, { name: 'OHIO', abbreviation: 'OH'}, { name: 'OKLAHOMA', abbreviation: 'OK'}, { name: 'OREGON', abbreviation: 'OR'}, { name: 'PALAU', abbreviation: 'PW'}, { name: 'PENNSYLVANIA', abbreviation: 'PA'}, { name: 'PUERTO RICO', abbreviation: 'PR'}, { name: 'RHODE ISLAND', abbreviation: 'RI'}, { name: 'SOUTH CAROLINA', abbreviation: 'SC'}, { name: 'SOUTH DAKOTA', abbreviation: 'SD'}, { name: 'TENNESSEE', abbreviation: 'TN'}, { name: 'TEXAS', abbreviation: 'TX'}, { name: 'UTAH', abbreviation: 'UT'}, { name: 'VERMONT', abbreviation: 'VT'}, { name: 'VIRGIN ISLANDS', abbreviation: 'VI'}, { name: 'VIRGINIA', abbreviation: 'VA'}, { name: 'WASHINGTON', abbreviation: 'WA'}, { name: 'WEST VIRGINIA', abbreviation: 'WV'}, { name: 'WISCONSIN', abbreviation: 'WI'}, { name: 'WYOMING', abbreviation: 'WY' }]);
  str = str.toUpperCase();
  for (var i = 0; i < states.length; i++) {
    var state = states[i];
    if(str.length === 2 && state.abbreviation === str) {
      return true;
    }
    if(str.length !== 2 && state.name === str) {
      return true;
    }
  }
  return false;
});

validator.extend('isZipCode', function (str, type) {
  switch(type) {
    case 'US':
    var usRegex = /^\d{5}(?:[-\s]\d{4})$/;
    return usRegex.test(str);
    default:
    return false;
  }
});

validator.extend('isTic', function (str) {
  var tics = Object.freeze(['00000','10000','10001','10005','10010','10040','10060','10070','11010','11099','20000','20010','20015','20020','20030','20040','20050','20060','20070','20080','20090','20100','20110','20120','20150','20160','20170','20180','20190','30000','30015','30040','30100','31000','40000','40010','40020','40030','40040','40050','40060','41000','41010','41020','41030','50000','51000','52000','52125','52245','52365','52490','53000','54000','54065','54125','54185','54245','60000','60010','60020','60030','60040','60050','60060','61000','61010','61020','61325','61330','61340','61350','90010','90011','90012','90100','90101','90102','90118','90119','90200','91000','91010','91011','91020','91030','91040','91041','91050','91051','91060','92010','92016','94000','94001','94002', '94003']);
  if(tics.indexOf(str) !== -1) {
    return true;
  }
  return false;
});