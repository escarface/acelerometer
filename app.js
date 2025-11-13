// Elementos del DOM
const startBtn = document.getElementById('startBtn');
const xValue = document.getElementById('xValue');
const yValue = document.getElementById('yValue');
const zValue = document.getElementById('zValue');
const status = document.getElementById('status');
const chartCanvas = document.getElementById('chart');
const toggleX = document.getElementById('toggleX');
const toggleY = document.getElementById('toggleY');
const toggleZ = document.getElementById('toggleZ');

// Variables de estado
let isRunning = false;
let chart = null;

// Configuración de datos
const MAX_DATA_POINTS = 100;
const dataPoints = {
    labels: [],
    x: [],
    y: [],
    z: []
};

// Inicializar gráfica
function initChart() {
    const ctx = chartCanvas.getContext('2d');

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dataPoints.labels,
            datasets: [
                {
                    label: 'Eje X',
                    data: dataPoints.x,
                    borderColor: '#ff6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Eje Y',
                    data: dataPoints.y,
                    borderColor: '#36a2eb',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Eje Z',
                    data: dataPoints.z,
                    borderColor: '#4bc0c0',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'm/s²'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });
}

// Actualizar datos de la gráfica
function updateChart(x, y, z) {
    const timestamp = dataPoints.labels.length;

    dataPoints.labels.push(timestamp);
    dataPoints.x.push(x);
    dataPoints.y.push(y);
    dataPoints.z.push(z);

    // Mantener solo los últimos MAX_DATA_POINTS puntos
    if (dataPoints.labels.length > MAX_DATA_POINTS) {
        dataPoints.labels.shift();
        dataPoints.x.shift();
        dataPoints.y.shift();
        dataPoints.z.shift();
    }

    if (chart) {
        chart.update('none'); // 'none' mode para mejor rendimiento
    }
}

// Controlar visibilidad de ejes en la gráfica
function toggleAxisVisibility(axisIndex, isVisible) {
    if (chart) {
        chart.data.datasets[axisIndex].hidden = !isVisible;
        chart.update();
    }
}

// Actualizar valores en pantalla
function updateValues(x, y, z) {
    xValue.textContent = x.toFixed(2);
    yValue.textContent = y.toFixed(2);
    zValue.textContent = z.toFixed(2);
}

// Manejar evento de movimiento del dispositivo
function handleMotion(event) {
    if (!isRunning) return;

    // Log solo la primera vez para debug
    if (dataPoints.labels.length === 0) {
        console.log('Primer evento devicemotion recibido:', event);
        console.log('Acceleration:', event.acceleration);
        console.log('AccelerationIncludingGravity:', event.accelerationIncludingGravity);
    }

    // Usar acceleration (sin gravedad) en lugar de accelerationIncludingGravity
    const acc = event.acceleration;

    // Si acceleration no está disponible, intentar con accelerationIncludingGravity
    if (!acc || (acc.x === null && acc.y === null && acc.z === null)) {
        const accWithGravity = event.accelerationIncludingGravity;
        if (accWithGravity && (accWithGravity.x !== null || accWithGravity.y !== null || accWithGravity.z !== null)) {
            const x = accWithGravity.x || 0;
            const y = accWithGravity.y || 0;
            const z = accWithGravity.z || 0;

            updateValues(x, y, z);
            updateChart(x, y, z);
        } else {
            console.warn('No hay datos de aceleración disponibles');
        }
        return;
    }

    if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;

        updateValues(x, y, z);
        updateChart(x, y, z);
    }
}

// Solicitar permisos (necesario para iOS 13+)
async function requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceMotionEvent.requestPermission();
            console.log('Permiso de DeviceMotion:', permission);
            if (permission === 'granted') {
                return true;
            } else {
                status.textContent = 'Permiso denegado. Por favor, permite el acceso al acelerómetro en la configuración de tu navegador.';
                status.className = 'status error';
                return false;
            }
        } catch (error) {
            console.error('Error al solicitar permisos:', error);
            status.textContent = 'Error al solicitar permisos: ' + error.message;
            status.className = 'status error';
            return false;
        }
    }
    return true; // No requiere permisos explícitos
}

// Iniciar/detener monitoreo
async function toggleMonitoring() {
    if (!isRunning) {
        // Verificar soporte
        if (!window.DeviceMotionEvent) {
            status.textContent = 'Tu dispositivo no soporta el acelerómetro';
            status.className = 'status error';
            return;
        }

        console.log('Tipo de DeviceMotionEvent:', typeof DeviceMotionEvent);
        console.log('¿Tiene requestPermission?', typeof DeviceMotionEvent.requestPermission);

        // Solicitar permisos
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        // Iniciar monitoreo
        isRunning = true;
        startBtn.textContent = 'Detener';
        startBtn.classList.add('active');
        status.textContent = 'Monitoreando...';
        status.className = 'status success';

        console.log('Iniciando escucha de eventos devicemotion...');
        window.addEventListener('devicemotion', handleMotion);

        // Timeout para verificar si recibimos datos
        setTimeout(() => {
            if (dataPoints.labels.length === 0) {
                status.textContent = 'No se están recibiendo datos del acelerómetro. Verifica los permisos.';
                status.className = 'status error';
                console.warn('No se han recibido eventos de devicemotion después de 3 segundos');
            }
        }, 3000);
    } else {
        // Detener monitoreo
        isRunning = false;
        startBtn.textContent = 'Iniciar';
        startBtn.classList.remove('active');
        status.textContent = 'Detenido';
        status.className = 'status';

        window.removeEventListener('devicemotion', handleMotion);
    }
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initChart();
    startBtn.addEventListener('click', toggleMonitoring);

    // Event listeners para los toggles de ejes
    toggleX.addEventListener('change', (e) => {
        toggleAxisVisibility(0, e.target.checked);
    });

    toggleY.addEventListener('change', (e) => {
        toggleAxisVisibility(1, e.target.checked);
    });

    toggleZ.addEventListener('change', (e) => {
        toggleAxisVisibility(2, e.target.checked);
    });

    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(() => console.log('Service Worker registrado'))
            .catch(err => console.log('Error al registrar Service Worker:', err));
    }
});
