const duelId = new URLSearchParams(window.location.search).get('duelId');
const backendUrl = 'https://duel-bot-backend-production.up.railway.app';

async function fetchDuelState() {
  try {
    const res = await fetch(`${backendUrl}/duel/live/${duelId}`);
    if (!res.ok) throw new Error('Failed to fetch duel state');

    const duelState = await res.json();
    renderSpectatorView(duelState);
  } catch (err) {
    console.error("Spectator fetch error:", err);
    document.getElementById('spectator-status').textContent = 'Failed to load duel.';
  }
}

function renderSpectatorView(state) {
  document.getElementById('turn-display').textContent = `Current Turn: ${state.currentPlayer}`;
  document.getElementById('watching-count').textContent = `Spectators Watching: ${state.spectators.length}`;

  renderPlayer('player1', state.players.player1);
  renderPlayer('player2', state.players.player2);
}

function renderPlayer(playerKey, playerData) {
  const playerDiv = document.getElementById(playerKey);
  playerDiv.querySelector('.hp').textContent = `HP: ${playerData.hp}`;

  const field = playerDiv.querySelector('.field');
  const hand = playerDiv.querySelector('.hand');
  field.innerHTML = '';
  hand.innerHTML = '';

  playerData.field.forEach(card => field.appendChild(renderCard(card.cardId, false)));
  playerData.hand.forEach(() => hand.appendChild(renderCard('000_WinterlandDeathDeck_Back', true)));
}

function renderCard(cardId, isFaceDown) {
  const cardDiv = document.createElement('div');
  cardDiv.classList.add('card');

  const img = document.createElement('img');
  const name = document.createElement('div');
  name.classList.add('card-name');

  if (isFaceDown) {
    img.src = 'images/cards/000_WinterlandDeathDeck_Back.png';
    name.textContent = '';
  } else {
    img.src = `images/cards/${cardId}.png`;
    img.onerror = () => {
      img.src = 'images/cards/000_WinterlandDeathDeck_Back.png';
    };
    name.textContent = cardId;
  }

  cardDiv.appendChild(img);
  cardDiv.appendChild(name);
  return cardDiv;
}

// Optional: Spectator Join Message
const username = new URLSearchParams(window.location.search).get('user');
if (username) {
  const msg = document.createElement('p');
  msg.textContent = `@${username} joined to watch the madness!`;
  msg.style.fontStyle = 'italic';
  msg.style.color = '#ccc';
  msg.style.textAlign = 'center';
  document.querySelector('.spectator-header').appendChild(msg);
}

// Auto-refresh loop
setInterval(fetchDuelState, 2000);
fetchDuelState();
