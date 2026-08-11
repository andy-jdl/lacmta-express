const express = require('express')
const twilio = require('twilio')
const { LRUCache } = require('lru-cache');
require('dotenv').config();

const app = express()

app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
    res.send('Hello World')
})

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
    const result = JSON.stringify(arrivals.data.predictionsData, null, 2);
    const stopPrediction = JSON.parse(result);

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

    if(lines.length === 0) {
        return "No upcoming arrivals found for this stop."
    }

    return lines.join('\n');
}

function validateTwilioRequest(req) {
    const authToken = process.env.SWIFTLY_API_KEY
    const url = process.env.TWILIO_WEBHOOK_URL;
    const twilioSignature = req.headers['x-twilio-signature']
    const params = req.body
    return twilio.validateRequest(authToken, twilioSignature, url, params)
}

app.post('/api/predict', async (req, res, next) => {
    const { From: from, Body: body } = req.body;

    if(!validateTwilioRequest(req)) {
        return res.status(403).send('Invalid signature')
    }
    
    try {
        if (isUserLimited(from)) {
            const err = new Error('Please try again later');
            err.status = 429;
            throw err;
        }

        const parts = body.trim().split(/\s+/);
        const [agency, stopId] = parts;

        if(agency !== "LACMTA") {
            const err = new Error('Agency name should be LACMTA');
            err.status = 400;
            throw err;
        }

        if (!/^\d+$/.test(stopId)) {
            const err = new Error('Stop ID must be a number');
            err.status = 400;
            throw err;
        }

        const arrivals = await resolveArrivals(stopId);
        const message = createArrivalMessage(arrivals);

        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(message);
        res.type('text/xml').send(twiml.toString());
    } catch (err) {
        next(err);
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Listening on PORT: ${PORT}`)
})