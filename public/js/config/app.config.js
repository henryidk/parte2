// app.config.js - Configuración global de la aplicación

/**
 * Configuración centralizada de la aplicación
 * Este archivo contiene toda la configuración parametrizable del sistema
 */
const AppConfig = {
    // === INFORMACIÓN DE LA APLICACIÓN ===
    app: {
        name: 'Sistema Gestión Universitaria',
        version: '1.0.0',
        buildDate: '2025-10-01',
        environment: 'development', // 'development' | 'production' | 'staging'
        debugMode: true // Solo para development
    },

    // === CONFIGURACIÓN DE API ===
    api: {
        baseUrl: '', // Dejar vacío para usar la misma URL del frontend
        timeout: 30000, // 30 segundos
        retryAttempts: 3,
        retryDelay: 1000, // 1 segundo
        endpoints: {
            login: '/api/login',
            logout: '/api/logout',
            forgotPassword: '/api/forgot-password',
            changePassword: '/api/usuarios/cambiar-password',
            dashboardStats: '/api/dashboard-stats',

            

            // Usuarios
            users: '/api/usuarios',
            userById: '/api/usuarios/:id',
            resetPassword: '/api/usuarios/:id/reset-password',

            // Bitácoras
            bitacoraAccesos: '/api/bitacora/accesos',
            bitacoraTransacciones: '/api/bitacora/transacciones'
        }
    },

    // === CONFIGURACIÓN DE UI ===
    ui: {
        // Temas
        defaultTheme: 'light',
        themes: ['light', 'dark'],

        // Idioma
        defaultLanguage: 'es',
        availableLanguages: ['es', 'en'],

        // Animaciones
        enableAnimations: true,
        animationDuration: 300,

        // Notificaciones/Toasts
        toast: {
            position: 'top-right', // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
            duration: {
                success: 3000,
                error: 7000,
                warning: 5000,
                info: 5000
            },
            maxVisible: 5
        },

        // Modales
        modal: {
            closeOnEscape: true,
            closeOnOverlayClick: true,
            enableBackdrop: true
        },

        // Sidebar
        sidebar: {
            collapsible: true,
            defaultCollapsed: false,
            persistState: true // Guardar estado en localStorage
        }
    },

    // === CONFIGURACIÓN DE PAGINACIÓN ===
    pagination: {
        defaultPageSize: 10,
        pageSizeOptions: [5, 10, 20, 50, 100],
        maxPageSize: 100,
        showFirstLast: true,
        showPrevNext: true,
        maxVisiblePages: 5
    },

    // === CONFIGURACIÓN DE BÚSQUEDA ===
    search: {
        minCharacters: 2,
        debounceDelay: 300, // ms
        maxResults: 100,
        caseSensitive: false,
        highlightResults: true
    },

    // === CONFIGURACIÓN DE VALIDACIÓN ===
    validation: {
        // Contraseñas
        password: {
            minLength: 8,
            maxLength: 128,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: true,
            preventCommonPasswords: true
        },

        // Usuarios
        username: {
            minLength: 3,
            maxLength: 50,
            allowedCharacters: /^[a-zA-Z0-9_.-]+$/
        },

        // Nombres
        name: {
            minLength: 2,
            maxLength: 100,
            allowedCharacters: /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/
        },

        // Email
        email: {
            maxLength: 120,
            allowedDomains: [], // Vacío = permitir todos
            blockedDomains: [] // Dominios bloqueados
        },

        // Teléfono
        phone: {
            minLength: 7,
            maxLength: 15,
            allowInternational: true
        }
    },

    // === CONFIGURACIÓN DE SEGURIDAD ===
    security: {
        // Sesión
        sessionTimeout: 1800000, // 30 minutos en ms
        sessionWarningTime: 300000, // 5 minutos antes de expirar
        rememberMeDuration: 2592000000, // 30 días en ms

        // Bloqueo de cuenta
        maxLoginAttempts: 5,
        lockoutDuration: 900000, // 15 minutos

        // reCAPTCHA
        recaptcha: {
            enabled: true,
            siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', // Clave de prueba
            secretKey: '', // Configurar en servidor
            version: 2,
            theme: 'light',
            size: 'normal'
        },

        // CSRF
        csrfProtection: false, // TODO: Implementar

        // XSS Protection
        sanitizeInputs: true,
        allowedHtmlTags: [], // Lista blanca de tags HTML permitidos

        // Headers de seguridad
        securityHeaders: {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
        }
    },

    // === CONFIGURACIÓN DE CACHÉ ===
    cache: {
        enabled: true,
        duration: 300000, // 5 minutos
        strategies: {
            dashboardStats: 60000, // 1 minuto
            users: 120000 // 2 minutos
        }
    },

    // === CONFIGURACIÓN DE LOGS ===
    logging: {
        enabled: true,
        level: 'debug', // 'debug' | 'info' | 'warn' | 'error'
        logToConsole: true,
        logToServer: false,
        includeTimestamp: true,
        includeStackTrace: true
    },

    // === CONFIGURACIÓN DE ARCHIVOS ===
    files: {
        upload: {
            maxSize: 5242880, // 5MB en bytes
            allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
            allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.pdf']
        },
        export: {
            defaultFormat: 'xlsx',
            availableFormats: ['xlsx', 'csv', 'pdf'],
            includeHeaders: true,
            dateFormat: 'DD/MM/YYYY'
        }
    },

    // === CONFIGURACIÓN DE FORMATO ===
    format: {
        // Fechas
        date: {
            locale: 'es-ES',
            shortDate: 'DD/MM/YYYY',
            longDate: 'dddd, DD de MMMM de YYYY',
            dateTime: 'DD/MM/YYYY HH:mm:ss',
            time: 'HH:mm:ss'
        },

        // Números
        number: {
            locale: 'es-ES',
            decimalSeparator: ',',
            thousandsSeparator: '.',
            decimals: 2
        },

        // Moneda
        currency: {
            locale: 'es-ES',
            currency: 'USD',
            symbol: '$',
            symbolPosition: 'before' // 'before' | 'after'
        }
    },

    // === CONFIGURACIÓN DE ROLES Y PERMISOS ===
    roles: {
        hierarchy: ['admin', 'secretaria', 'usuario'],
        defaultRole: 'usuario',

        permissions: {
            admin: [
                'view_dashboard',
                'view_users', 'create_users', 'edit_users', 'delete_users',
                'view_bitacoras',
                'reset_passwords',
                'manage_settings',
                'export_data'
            ],
            secretaria: [
                'view_dashboard',
                'view_own_profile',
                'export_data'
            ],
            usuario: [
                'view_own_profile'
            ]
        }
    },

    // === CONFIGURACIÓN DE DASHBOARD ===
    dashboard: {
        refreshInterval: 300000, // 5 minutos
        autoRefresh: false,
        defaultView: 'cards', // 'cards' | 'list' | 'grid'

        // Widgets
        widgets: {
            enableDrag: false, // Permitir reorganizar widgets
            enableResize: false // Permitir redimensionar widgets
        }
    },

    // === CONFIGURACIÓN DE TABLAS ===
    tables: {
        

        // Usuarios
        users: {
            defaultSort: 'fechaCreacion',
            defaultSortOrder: 'DESC',
            columnsVisible: ['nombreCompleto', 'email', 'rol', 'estado'],
            exportable: true
        },

        // Bitácoras
        bitacoras: {
            defaultLimit: 20,
            maxLimit: 100,
            exportable: true
        }
    },

    // === CONFIGURACIÓN DE CORREO ===
    email: {
        provider: 'brevo', // 'brevo' | 'smtp' | 'sendgrid'
        sender: {
            name: 'Sistema AcademicoDB',
            email: 'henryalibat4@gmail.com'
        },
        templates: {
            passwordReset: 'password-reset',
            welcome: 'welcome',
            accountLocked: 'account-locked'
        }
    },

    // === CONFIGURACIÓN DE DESARROLLO ===
    development: {
        mockData: false,
        slowNetwork: false, // Simular red lenta
        showDebugInfo: true,
        verboseLogging: true
    },

    // === FEATURES FLAGS ===
    features: {
        darkMode: true,
        multiLanguage: false,
        notifications: false,
        reports: false,
        advancedSearch: false,
        bulkOperations: false,
        dataExport: true,
        dataImport: false,
        userProfiles: true,
        changePassword: true,
        forgotPassword: true
    }
};

// === MÉTODOS HELPER ===
AppConfig.getEndpoint = function(name, params = {}) {
    let endpoint = this.api.endpoints[name];

    if (!endpoint) {
        console.error(`Endpoint '${name}' no encontrado en configuración`);
        return '';
    }

    // Reemplazar parámetros en la URL
    for (const [key, value] of Object.entries(params)) {
        endpoint = endpoint.replace(`:${key}`, value);
    }

    return this.api.baseUrl + endpoint;
};

AppConfig.hasPermission = function(role, permission) {
    const permissions = this.roles.permissions[role];
    return permissions && permissions.includes(permission);
};

AppConfig.isFeatureEnabled = function(feature) {
    return this.features[feature] === true;
};

AppConfig.isDevelopment = function() {
    return this.app.environment === 'development';
};

AppConfig.isProduction = function() {
    return this.app.environment === 'production';
};

// Congelar configuración en producción
if (AppConfig.isProduction()) {
    Object.freeze(AppConfig);
}

// Exportar
window.AppConfig = AppConfig;
window.Config = AppConfig; // Alias

console.log(`📋 ${AppConfig.app.name} v${AppConfig.app.version} - Configuración cargada`);
console.log(`🔧 Entorno: ${AppConfig.app.environment}`);
