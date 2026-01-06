// Конфигурация
const SERVER_URL = window.location.origin; // Текущий домен
let socket = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let localUserId = null;
let remoteUserId = null;
let isInCall = false;
let isMicEnabled = true;
let isAudioEnabled = true;
let audioContext = null;
let localAnalyser = null;
let remoteAnalyser = null;

// Элементы DOM
const localIdEl = document.getElementById('localId');
const connectionStatusEl = document.getElementById('connectionStatus');
const callStatusEl = document.getElementById('callStatus');
const usersListEl = document.getElementById('usersList');
const onlineCountEl = document.getElementById('onlineCount');
const localStatusEl = document.getElementById('localStatus');
const remoteStatusEl = document.getElementById('remoteStatus');
const remotePlaceholderEl = document.getElementById('remotePlaceholder');
const callerInfoEl = document.getElementById('callerInfo');
const callerNameEl = document.getElementById('callerName');
const localVolumeEl = document.getElementById('localVolume');
const remoteVolumeEl = document.getElementById('remoteVolume');
const localVisualizerEl = document.getElementById('localVisualizer');
const remoteVisualizerEl = document.getElementById('remoteVisualizer');
const chatWithEl = document.getElementById('chatWith');
const chatMessagesEl = document.getElementById('chatMessages');
const messageInputEl = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const remoteIdInputEl = document.getElementById('remoteIdInput');
const logEl = document.getElementById('log');

// Кнопки
const startCallBtn = document.getElementById('startCall');
const endCallBtn = document.getElementById('endCall');
const acceptCallBtn = document.getElementById('acceptCall');
const rejectCallBtn = document.getElementById('rejectCall');
const callUserBtn = document.getElementById('callUser');
const toggleMicBtn = document.getElementById('toggleMic');
const toggleAudioBtn = document.getElementById('toggleAudio');
const copyIdBtn = document.getElementById('copyId');
const testAudioBtn = document.getElementById('testAudio');
const shareLinkBtn = document.getElementById('shareLink');
const clearLogBtn = document.getElementById('clearLog');

// ICE серверы (STUN/TURN)
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Бесплатные TURN серверы (могут быть перегружены)
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10
};

// Инициализация
async function init() {
    logSystem('Инициализация голосового чата...');
    
    // Генерация уникального ID пользователя
    localUserId = 'user_' + Math.random().toString(36).substring(2, 9);
    localIdEl.textContent = localUserId;
    
    // Подключение к серверу
    await connectToServer();
    
    // Запрос доступа к микрофону
    await getLocalStream();
    
    // Инициализация аудиоанализаторов
    initAudioAnalyzers();
    
    // Настройка обработчиков событий
    setupEventListeners();
    
    logSuccess('Приложение готово к работе!');
    showNotification('Голосовой чат', 'Вы успешно подключились!', 'success');
}

// Подключение к сигнальному серверу
async function connectToServer() {
    try {
        socket = io(SERVER_URL);
        
        socket.on('connect', () => {
            logSuccess('Подключено к серверу');
            connectionStatusEl.textContent = 'Онлайн';
            connectionStatusEl.className = 'status online';
            
            // Регистрация пользователя на сервере
            socket.emit('register', localUserId);
        });
        
        socket.on('registered', (data) => {
            logSuccess(`Зарегистрирован как ${localUserId}`);
            updateOnlineUsers(data.onlineUsers || []);
            startCallBtn.disabled = false;
            callUserBtn.disabled = false;
        });
        
        socket.on('online-users', (users) => {
            updateOnlineUsers(users);
        });
        
        socket.on('online-users-updated', (users) => {
            updateOnlineUsers(users);
        });
        
        socket.on('incoming-call', async (data) => {
            logWarning(`Входящий звонок от ${data.callerName || data.from}`);
            showIncomingCall(data);
        });
        
        socket.on('call-initiated', (data) => {
            logInfo(`Вызов пользователю ${data.to} отправлен`);
            showNotification('Звонок', `Вызываем ${data.to}...`, 'info');
        });
        
        socket.on('call-accepted', async (data) => {
            logSuccess(`${data.from} принял звонок`);
            await handleCallAccepted(data.answer);
        });
        
        socket.on('call-rejected', (data) => {
            logError(`${data.from} отклонил звонок`);
            showNotification('Звонок', `${data.from} отклонил вызов`, 'error');
            resetCallUI();
        });
        
        socket.on('call-cancelled', (data) => {
            logWarning(`${data.from} отменил звонок`);
            showNotification('Звонок', `${data.from} отменил вызов`, 'warning');
            resetCallUI();
        });
        
        socket.on('call-ended', (data) => {
            logWarning(`${data.from} завершил звонок`);
            showNotification('Звонок', 'Собеседник завершил вызов', 'warning');
            endCall();
        });
        
        socket.on('ice-candidate', (data) => {
            if (peerConnection && data.candidate) {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                    .catch(err => logError(`Ошибка добавления ICE: ${err}`));
            }
        });
        
        socket.on('new-message', (data) => {
            addMessageToChat(data.from, data.message, data.timestamp, 'incoming');
        });
        
        socket.on('user-disconnected', (data) => {
            logWarning(`${data.userId} отключился`);
            if (remoteUserId === data.userId) {
                showNotification('Собеседник', `${data.userId} отключился`, 'warning');
                endCall();
            }
        });
        
        socket.on('user-offline', (data) => {
            logError(`Пользователь ${data.userId} не в сети`);
            showNotification('Ошибка', `${data.userId} не в сети`, 'error');
        });
        
        socket.on('disconnect', () => {
            logError('Отключено от сервера');
            connectionStatusEl.textContent = 'Оффлайн';
            connectionStatusEl.className = 'status offline';
            showNotification('Соединение', 'Потеряно подключение к серверу', 'error');
        });
        
    } catch (error) {
        logError(`Ошибка подключения: ${error}`);
        showNotification('Ошибка', 'Не удалось подключиться к серверу', 'error');
    }
}

// Получение локального медиапотока
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            },
            video: false
        });
        
        logSuccess('Микрофон активирован');
        localStatusEl.textContent = 'Микрофон активен';
        
        // Визуализация аудио
        if (audioContext && localAnalyser) {
            const source = audioContext.createMediaStreamSource(localStream);
            source.connect(localAnalyser);
        }
        
    } catch (error) {
        logError(`Ошибка доступа к микрофону: ${error.message}`);
        showNotification('Ошибка', 'Не удалось получить доступ к микрофону', 'error');
        
        // Создаем заглушку для демо
        localStream = await createFallbackAudioStream();
    }
}

// Создание заглушки для аудио (для демо)
async function createFallbackAudioStream() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const dst = oscillator.connect(audioContext.createMediaStreamDestination());
    oscillator.start();
    return dst.stream;
}

// Инициализация аудиоанализаторов
function initAudioAnalyzers() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Анализатор для локального аудио
        localAnalyser = audioContext.createAnalyser();
        localAnalyser.fftSize = 256;
        localAnalyser.smoothingTimeConstant = 0.3;
        
        // Анализатор для удаленного аудио
        remoteAnalyser = audioContext.createAnalyser();
        remoteAnalyser.fftSize = 256;
        remoteAnalyser.smoothingTimeConstant = 0.3;
        
        // Запуск визуализации
        visualizeAudio();
        
    } catch (error) {
        console.warn('Аудиоанализаторы не поддерживаются:', error);
    }
}

// Визуализация аудио
function visualizeAudio() {
    if (!localAnalyser || !remoteAnalyser) return;
    
    const bufferLength = localAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function updateVisualizers() {
        requestAnimationFrame(updateVisualizers);
        
        // Локальный аудио
        localAnalyser.getByteFrequencyData(dataArray);
        const localVolume = dataArray.reduce((a, b) => a + b) / bufferLength;
        updateVolumeIndicator(localVolumeEl, localVolume);
        updateVisualizerBars(localVisualizerEl, dataArray);
        
        // Удаленный аудио
        if (remoteStream && remoteAnalyser) {
            remoteAnalyser.getByteFrequencyData(dataArray);
            const remoteVolume = dataArray.reduce((a, b) => a + b) / bufferLength;
            updateVolumeIndicator(remoteVolumeEl, remoteVolume);
            updateVisualizerBars(remoteVisualizerEl, dataArray);
        }
    }
    
    updateVisualizers();
}

// Обновление индикатора громкости
function updateVolumeIndicator(indicator, volume) {
    const percent = Math.min(volume / 2, 100);
    indicator.querySelector('.volume-bar').style.width = `${percent}%`;
}

// Обновление баров визуализатора
function updateVisualizerBars(visualizer, dataArray) {
    const bars = visualizer.querySelectorAll('.bar');
    const step = Math.floor(dataArray.length / bars.length);
    
    bars.forEach((bar, i) => {
        const value = dataArray[i * step] || 0;
        const height = Math.max(5, value / 2);
        bar.style.height = `${height}%`;
    });
    
    visualizer.classList.toggle('active', dataArray.some(v => v > 10));
}

// Создание PeerConnection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(iceServers);
    
    // Добавление локального потока
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Обработка удаленного потока
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        
        // Подключение удаленного аудио к анализатору
        if (audioContext && remoteAnalyser) {
            const remoteSource = audioContext.createMediaStreamSource(remoteStream);
            remoteSource.connect(remoteAnalyser);
        }
        
        // Обновление UI
        remoteStatusEl.textContent = 'Подключен';
        remotePlaceholderEl.style.display = 'none';
        
        logSuccess('Установлено аудиосоединение');
        showNotification('Соединение', 'Аудиосоединение установлено', 'success');
    };
    
    // Обработка ICE кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && remoteUserId) {
            socket.emit('ice-candidate', {
                to: remoteUserId,
                candidate: event.candidate
            });
        }
    };
    
    // Отслеживание состояния соединения
    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        logInfo(`Состояние ICE: ${state}`);
        
        if (state === 'disconnected' || state === 'failed') {
            logError('Соединение прервано');
            showNotification('Соединение', 'Проблемы с соединением', 'error');
        }
        
        if (state === 'closed') {
            resetCallUI();
        }
    };
}

// Начало звонка
async function startCall(targetUserId = null) {
    if (!targetUserId) {
        targetUserId = remoteIdInputEl.value.trim();
    }
    
    if (!targetUserId) {
        showNotification('Ошибка', 'Введите ID пользователя', 'error');
        return;
    }
    
    if (targetUserId === localUserId) {
        showNotification('Ошибка', 'Нельзя позвонить самому себе', 'error');
        return;
    }
    
    remoteUserId = targetUserId;
    
    logInfo(`Начало звонка пользователю ${remoteUserId}`);
    
    // Обновление UI
    callStatusEl.innerHTML = '<i class="fas fa-phone"></i><span>Звоню...</span>';
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    remoteStatusEl.textContent = 'Вызываем...';
    remotePlaceholderEl.className = 'placeholder waiting';
    remotePlaceholderEl.innerHTML = '<i class="fas fa-phone"></i><p>Вызываем...</p>';
    
    // Создание PeerConnection
    createPeerConnection();
    
    try {
        // Создание предложения
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await peerConnection.setLocalDescription(offer);
        
        // Отправка предложения через сигнальный сервер
        socket.emit('call-user', {
            from: localUserId,
            to: remoteUserId,
            offer: offer
        });
        
        isInCall = true;
        updateChatUI();
        
    } catch (error) {
        logError(`Ошибка начала звонка: ${error}`);
        showNotification('Ошибка', 'Не удалось начать звонок', 'error');
        endCall();
    }
}

// Обработка входящего звонка
function showIncomingCall(data) {
    remoteUserId = data.from;
    callerNameEl.textContent = data.callerName || data.from;
    
    // Показать UI для принятия/отклонения
    acceptCallBtn.style.display = 'flex';
    rejectCallBtn.style.display = 'flex';
    startCallBtn.style.display = 'none';
    endCallBtn.style.display = 'none';
    
    // Обновление UI
    remotePlaceholderEl.style.display = 'none';
    callerInfoEl.style.display = 'block';
    
    // Сохранение предложения для дальнейшей обработки
    window.incomingCallData = data;
    
    // Уведомление
    showNotification('Входящий звонок', `${data.callerName || data.from} звонит вам`, 'call', 30000);
}

// Принятие входящего звонка
async function acceptIncomingCall() {
    if (!window.incomingCallData) return;
    
    logInfo(`Принятие звонка от ${remoteUserId}`);
    
    // Скрыть кнопки принятия/отклонения
    acceptCallBtn.style.display = 'none';
    rejectCallBtn.style.display = 'none';
    startCallBtn.style.display = 'none';
    endCallBtn.style.display = 'flex';
    
    // Обновление UI
    callStatusEl.innerHTML = '<i class="fas fa-phone"></i><span>В разговоре</span>';
    remoteStatusEl.textContent = 'Подключение...';
    callerInfoEl.style.display = 'none';
    remotePlaceholderEl.style.display = 'flex';
    remotePlaceholderEl.className = 'placeholder';
    remotePlaceholderEl.innerHTML = '<i class="fas fa-user-friends"></i><p>Подключение...</p>';
    
    // Создание PeerConnection
    createPeerConnection();
    
    try {
        // Установка удаленного описания
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(window.incomingCallData.offer)
        );
        
        // Создание ответа
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        // Отправка ответа
        socket.emit('accept-call', {
            from: localUserId,
            to: remoteUserId,
            answer: answer
        });
        
        isInCall = true;
        updateChatUI();
        
        logSuccess('Звонок принят');
        showNotification('Звонок', 'Вы приняли звонок', 'success');
        
        // Очистка временных данных
        delete window.incomingCallData;
        
    } catch (error) {
        logError(`Ошибка принятия звонка: ${error}`);
        showNotification('Ошибка', 'Не удалось принять звонок', 'error');
        endCall();
    }
}

// Обработка принятого звонка
async function handleCallAccepted(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Обновление UI
        callStatusEl.innerHTML = '<i class="fas fa-phone"></i><span>В разговоре</span>';
        remoteStatusEl.textContent = 'Подключен';
        remotePlaceholderEl.style.display = 'none';
        
        isInCall = true;
        
    } catch (error) {
        logError(`Ошибка обработки ответа: ${error}`);
    }
}

// Завершение звонка
function endCall() {
    logWarning('Завершение звонка');
    
    // Отправка уведомления собеседнику
    if (remoteUserId && socket) {
        socket.emit('end-call', {
            from: localUserId,
            to: remoteUserId
        });
    }
    
    // Закрытие PeerConnection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Остановка удаленного потока
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    
    // Сброс UI
    resetCallUI();
    
    isInCall = false;
    remoteUserId = null;
    
    showNotification('Звонок', 'Разговор завершен', 'info');
}

// Сброс UI звонка
function resetCallUI() {
    callStatusEl.innerHTML = '<i class="fas fa-circle"></i><span>Готов к звонку</span>';
    
    startCallBtn.style.display = 'flex';
    startCallBtn.disabled = false;
    endCallBtn.style.display = 'flex';
    endCallBtn.disabled = true;
    acceptCallBtn.style.display = 'none';
    rejectCallBtn.style.display = 'none';
    
    remoteStatusEl.textContent = 'Не подключен';
    remotePlaceholderEl.style.display = 'flex';
    remotePlaceholderEl.className = 'placeholder';
    remotePlaceholderEl.innerHTML = '<i class="fas fa-phone"></i><p>Ожидание звонка</p>';
    callerInfoEl.style.display = 'none';
    
    updateChatUI();
}

// Обновление списка онлайн пользователей
function updateOnlineUsers(users) {
    const filteredUsers = users.filter(user => user !== localUserId);
    onlineCountEl.textContent = filteredUsers.length;
    
    if (filteredUsers.length === 0) {
        usersListEl.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-slash"></i>
                <p>Нет пользователей онлайн</p>
            </div>
        `;
        return;
    }
    
    usersListEl.innerHTML = '';
    filteredUsers.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
            <div class="user-name">
                <i class="fas fa-user-circle"></i>
                <span>${user}</span>
            </div>
            <button class="call-btn" onclick="startCall('${user}')">
                <i class="fas fa-phone"></i>
            </button>
        `;
        usersListEl.appendChild(userItem);
    });
}

// Обновление UI чата
function updateChatUI() {
    if (isInCall && remoteUserId) {
        chatWithEl.textContent = `Чат с ${remoteUserId}`;
        messageInputEl.disabled = false;
        sendMessageBtn.disabled = false;
        messageInputEl.placeholder = `Сообщение для ${remoteUserId}...`;
        
        // Очистка предыдущих сообщений
        chatMessagesEl.innerHTML = `
            <div class="empty-chat">
                <i class="fas fa-comment"></i>
                <p>Начните общение с ${remoteUserId}</p>
            </div>
        `;
    } else {
        chatWithEl.textContent = 'Нет активного чата';
        messageInputEl.disabled = true;
        sendMessageBtn.disabled = true;
        messageInputEl.placeholder = 'Введите сообщение...';
        messageInputEl.value = '';
    }
}

// Отправка сообщения
function sendMessage() {
    const message = messageInputEl.value.trim();
    if (!message || !remoteUserId || !isInCall) return;
    
    // Добавление сообщения в локальный чат
    addMessageToChat(localUserId, message, new Date().toISOString(), 'outgoing');
    
    // Отправка сообщения собеседнику
    socket.emit('send-message', {
        from: localUserId,
        to: remoteUserId,
        message: message
    });
    
    // Очистка поля ввода
    messageInputEl.value = '';
    messageInputEl.focus();
}

// Добавление сообщения в чат
function addMessageToChat(sender, message, timestamp, type) {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Удаление пустого состояния
    const emptyChat = chatMessagesEl.querySelector('.empty-chat');
    if (emptyChat) emptyChat.remove();
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.innerHTML = `
        <div class="message-header">
            <span class="message-sender">${sender}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${message}</div>
    `;
    
    chatMessagesEl.appendChild(messageEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Переключение микрофона
function toggleMicrophone() {
    if (!localStream) return;
    
    isMicEnabled = !isMicEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isMicEnabled;
    });
    
    toggleMicBtn.classList.toggle('mic-on', isMicEnabled);
    toggleMicBtn.classList.toggle('mic-off', !isMicEnabled);
    toggleMicBtn.innerHTML = `
        <i class="fas fa-microphone${isMicEnabled ? '' : '-slash'}"></i>
        <span>Микрофон</span>
    `;
    
    localStatusEl.textContent = isMicEnabled ? 'Микрофон активен' : 'Микрофон выключен';
    
    const status = isMicEnabled ? 'включен' : 'выключен';
    logInfo(`Микрофон ${status}`);
    showNotification('Микрофон', `Микрофон ${status}`, 'info');
}

// Переключение звука
function toggleAudio() {
    isAudioEnabled = !isAudioEnabled;
    
    // Отключение/включение удаленного аудио
    if (remoteStream) {
        remoteStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioEnabled;
        });
    }
    
    toggleAudioBtn.classList.toggle('audio-on', isAudioEnabled);
    toggleAudioBtn.classList.toggle('audio-off', !isAudioEnabled);
    toggleAudioBtn.innerHTML = `
        <i class="fas fa-volume-${isAudioEnabled ? 'up' : 'mute'}"></i>
        <span>Звук</span>
    `;
    
    const status = isAudioEnabled ? 'включен' : 'выключен';
    logInfo(`Звук ${status}`);
    showNotification('Звук', `Звук ${status}`, 'info');
}

// Копирование ID
function copyUserId() {
    navigator.clipboard.writeText(localUserId)
        .then(() => {
            logSuccess('ID скопирован в буфер обмена');
            showNotification('ID пользователя', 'Скопирован в буфер обмена', 'success');
        })
        .catch(err => {
            logError(`Ошибка копирования: ${err}`);
        });
}

// Тестирование звука
function testAudio() {
    logInfo('Тестирование звука...');
    
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    // Короткий звуковой сигнал
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
        oscillator.stop(audioContext.currentTime + 0.5);
        
        logSuccess('Тестовый звук воспроизведен');
        showNotification('Тест звука', 'Проверка завершена', 'success');
        
    } catch (error) {
        logError(`Ошибка теста звука: ${error}`);
    }
}

// Поделиться ссылкой
function shareLink() {
    const link = window.location.href;
    const message = `Присоединяйтесь ко мне в голосовом чате! Мой ID: ${localUserId}\n${link}`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Голосовой чат',
            text: message,
            url: link
        });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(message).then(() => {
            showNotification('Приглашение', 'Ссылка скопирована в буфер', 'success');
        });
    } else {
        prompt('Скопируйте ссылку:', message);
    }
}

// Показать уведомление
function showNotification(title, message, type = 'info', duration = 5000) {
    const notificationArea = document.getElementById('notificationArea');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fas fa-${
                type === 'call' ? 'phone' :
                type === 'success' ? 'check-circle' :
                type === 'error' ? 'exclamation-circle' :
                'info-circle'
            }"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    notificationArea.appendChild(notification);
    
    // Автоматическое удаление
    if (duration > 0) {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, duration);
    }
}

// Логирование
function logSystem(message) { addLog(message, 'system'); }
function logInfo(message) { addLog(message, 'info'); }
function logSuccess(message) { addLog(message, 'success'); }
function logWarning(message) { addLog(message, 'warning'); }
function logError(message) { addLog(message, 'error'); }

function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-${type}">${message}</span>
    `;
    
    logEl.appendChild(logEntry);
    logEl.scrollTop = logEl.scrollHeight;
    
    // Ограничение количества записей
    const maxEntries = 100;
    while (logEl.children.length > maxEntries) {
        logEl.removeChild(logEl.firstChild);
    }
}

// Очистка логов
function clearLogs() {
    logEl.innerHTML = '';
    logSystem('Лог очищен');
}

// Настройка обработчиков событий
function setupEventListeners() {
    startCallBtn.addEventListener('click', () => startCall());
    endCallBtn.addEventListener('click', endCall);
    acceptCallBtn.addEventListener('click', acceptIncomingCall);
    rejectCallBtn.addEventListener('click', () => {
        if (window.incomingCallData) {
            socket.emit('reject-call', {
                from: localUserId,
                to: window.incomingCallData.from
            });
            delete window.incomingCallData;
        }
        resetCallUI();
        showNotification('Звонок', 'Вы отклонили звонок', 'info');
    });
    
    callUserBtn.addEventListener('click', () => startCall());
    toggleMicBtn.addEventListener('click', toggleMicrophone);
    toggleAudioBtn.addEventListener('click', toggleAudio);
    copyIdBtn.addEventListener('click', copyUserId);
    testAudioBtn.addEventListener('click', testAudio);
    shareLinkBtn.addEventListener('click', shareLink);
    clearLogBtn.addEventListener('click', clearLogs);
    
    messageInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    sendMessageBtn.addEventListener('click', sendMessage);
    
    // Автофокус на поле ввода ID при загрузке
    remoteIdInputEl.focus();
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', init);

// Обработка закрытия вкладки
window.addEventListener('beforeunload', () => {
    if (isInCall && socket) {
        socket.emit('end-call', {
            from: localUserId,
            to: remoteUserId
        });
    }
});