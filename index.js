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
  if(cart.items.length > 100) {
    return callbackl('The maximum items in a cart is 100.');
  }
  var cartItems = builder.create('tax:cartItems');
  for (var i = 0; i < cart.items.length; i++) {
    var item = cart.items[i];
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
  if(str.length !== 2) {
    return false;
  }
  str = str.toUpperCase();
  var states = ['AL','AK','AS','AZ','AR','CA','CO','CT','DE','DC','FM','FL','GA','GU','HI','ID','IL','IN','IA','KS','KY','LA','ME','MH','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','MP','OH','OK','OR','PW','PA','PR','RI','SC','SD','TN','TX','UT','VT','VI','VA','WA','WV','WI','WY']
  if(states.indexOf(str) !== -1) {
    return true;
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
  var tics = ['00000','10000','10001','10005','10010','10040','10060','10070','11010','11099','20000','20010','20015','20020','20030','20040','20050','20060','20070','20080','20090','20100','20110','20120','20150','20160','20170','20180','20190','30000','30015','30040','30100','31000','40000','40010','40020','40030','40040','40050','40060','41000','41010','41020','41030','50000','51000','52000','52125','52245','52365','52490','53000','54000','54065','54125','54185','54245','60000','60010','60020','60030','60040','60050','60060','61000','61010','61020','61325','61330','61340','61350','90010','90011','90012','90100','90101','90102','90118','90119','90200','91000','91010','91011','91020','91030','91040','91041','91050','91051','91060','92010','92016','94000','94001','94002', '94003'];
  if(tics.indexOf(str) !== -1) {
    return true;
  }
  return false;
});