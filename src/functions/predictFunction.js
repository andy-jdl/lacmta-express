const twilio = require('twilio')
const { LRUCache } = require('lru-cache');
const { app: functionApp } = require('@azure/functions');
require('dotenv').config();

const userCache = new LRUCache({
    max: 160,
    ttl: 3 * 60 * 1000,
});

function isUserLimited(from) {
    const MAX_ATTEMPTS = 5;
    const user = userCache.get(from);

    if(!user) {
        userCache.set(from, { attempts: 1})
        return false;
    }

    if(user.attempts >= MAX_ATTEMPTS) {
        return true;
    }

    userCache.set(from, { attempts: user.attempts + 1 });
    return false;
}

async function resolveArrivals(stopId) {
    const API_URL = `https://api.goswift.ly/real-time/lametro/predictions?stop=${stopId}&number=2`
    const API_KEY = process.env.SWIFTLY_API_KEY;

    const response = await fetch(API_URL, {
        headers: {
            "Accept": "application/json",
            "Authorization": `${API_KEY}`
        },
        signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
        const err = new Error(`Swiftly API error: ${response.status}`);
        err.status = response.status >= 500 ? 502 : 400;
        throw err;
    }

    const result = await response.json();
    return result;
}   

function createArrivalMessage(arrivals) {
    const stopPrediction = arrivals.data.predictionsData;

    const lines = [];
    const stopName = stopPrediction[0].stopName;

    if(stopName) {
        lines.push(stopName);
    }
    
    for(const route of stopPrediction){
        for(const dest of route.destinations) {
            if(!dest.predictions || dest.predictions.length === 0) {
                continue;
            }

            const times = dest.predictions.map(p => `${p.min} min`).join(', ');
            lines.push(`${route.routeShortName} to ${dest.headsign}: ${times}`)
        }
    }

    if(lines.length <= 1) {
      const message = 'No upcoming arrivals found for this stop.'
      lines.push(message)
    }

    return lines.join('\n');
}

async function validateTwilioRequest(twilioSignature, params) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const url = process.env.TWILIO_WEBHOOK_URL_DEV;
    const entryParams = Object.fromEntries(params);
    return twilio.validateRequest(authToken, twilioSignature, url, entryParams)
}

function toTwiml(message) {
  const twiml = new twilio.twiml.MessagingResponse();
  return twiml.message(message);
}

functionApp.http('predictHttpTrigger', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const twilioSignature = request.headers.get('x-twilio-signature');
    const params = new URLSearchParams(await request.text());
    if(!await validateTwilioRequest(twilioSignature, params)) {
      return {
        status: 403,
        body: 'Invalid Signature'
      }
    }

    try { 
      const sender = params.get('From');
      const body = params.get('Body');

      if (isUserLimited(sender)) {
        const twiml = toTwiml('Too many messages. Wait a few minutes and try again.')
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/xml'
          },
          body: twiml.toString()
        }
      }

      const parts = body.trim().split(/\s+/);
      const [agency, stopId] = parts;

      if (agency !== "LACMTA") {
        const twiml = toTwiml('Agency name must be LACMTA')
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/xml'
          },
          body: twiml.toString()
        }
      }

      if (!/^\d+$/.test(stopId)) {
        const twiml = toTwiml('Stop ID must be a number')
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/xml'
          },
          body: twiml.toString()
        }
      }

      const arrivals = await resolveArrivals(stopId);
      const message = createArrivalMessage(arrivals);

      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(message);
      return {
        status: 200, 
        headers: {
          'Content-Type': 'text/xml'
        },
        body: twiml.toString()
      }
    } catch (err) {
      context.error('Error handling Predict webhook: ', err.message);
      return {
        status: 500,
        headers: {
          'Content-Type': 'text/xml'
        },
        body: 'Internal Server Error'
      }
    }
  } 
});
