const { loginHandler } = require('./src/controllers/authController');
const taskController = require('./src/controllers/taskController');

async function testFetch() {
    try {
        const req = {
            query: {},
            user: {
                id: 26,
                role: 'FACILITY_MANAGER',
                facility_id: 2
            }
        };
        const res = {
            status: function(code) {
                this.statusCode = code;
                return this;
            },
            json: function(data) {
                console.log('STATUS:', this.statusCode);
                console.log('RESPONSE:', JSON.stringify(data, null, 2));
            }
        };
        await taskController.getTasksHandler(req, res);
    } catch (e) {
        console.error(e);
    }
}

testFetch();
