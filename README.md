# DeepBlue API Backend

## 🚀 Iniciar el Backend

**Opción 1: Desde la carpeta del backend**
```bash
cd deepblue-api
npm install
npm run dev
```

**Opción 2: Desde la raíz del proyecto**
```bash
cd c:\Users\User\deepblue-frontend\deepblue-api
npm install
npm run dev
```

El servidor estará corriendo en `http://localhost:3000`

## 🔑 Credenciales

- **Usuario demo**: `demo@gmail.com` / `demo`
- **Administrador**: `admin@gmail.com` / `deepblue`

## 📡 Endpoints Disponibles

### Autenticación
- `POST /api/register` - Registrar nuevo usuario
- `POST /api/login` - Iniciar sesión

### Usuario
- `GET /api/arrecife/:userId` - Obtener datos del usuario

### Admin
- `GET /api/admin/users` - Listar todos los usuarios

### Solicitudes de Recarga
- `POST /api/recharges` - Crear solicitud (con archivo)
- `GET /api/recharges` - Listar solicitudes
- `POST /api/recharges/:id/approve` - Aprobar solicitud
- `POST /api/recharges/:id/deny` - Denegar solicitud

## 📁 Archivos
- Comprobantes se guardan en `./uploads/`
- Datos en `./data.json`