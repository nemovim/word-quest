import mongoose from 'mongoose';

const userLevelHistorySchema = new mongoose.Schema(
	{
		level: { type: Number, required: true },
		recordedAt: { type: Date, required: true }
	},
	{ _id: false }
);

const userSchema = new mongoose.Schema(
	{
		_id: { type: String, required: true },
		email: { type: String, required: true },
		name: { type: String, required: true },
		currentLevel: { type: Number, required: true, default: 1 },
		levelHistory: {
			type: [userLevelHistorySchema],
			default: []
		}
	},
	{
		timestamps: true
	}
);

const UserModel = mongoose.models.User ?? mongoose.model('User', userSchema);

export default UserModel;
