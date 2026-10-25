import type { LanguageCode } from '$lib/shared/types/general.type';
import type { LevelReview, ReviewEntity, ReviewCreate } from '$lib/shared/types/review.type';

import ReviewModel from '$lib/models/review.model';
import { toPojo } from '$lib/shared/utils/general.util';

export async function findReviewsByUserId(userId: string): Promise<ReviewEntity[]> {
	const documents = await ReviewModel.find({ userId }).sort({ dueAt: 1, createdAt: 1 }).lean();
	return documents.map(toPojo<ReviewEntity>);
}

export async function findDueReviewGroupsByUser(
	userId: string,
	directionField: 'promptLang' | 'answerLang',
	directionLang: LanguageCode,
	now: Date,
	limit: number,
	excludedVocaIds: string[]
): Promise<{ reviewed: ReviewEntity[]; new: ReviewEntity[] }> {
	const commonFilter = {
		userId,
		[directionField]: directionLang,
		dueAt: { $lte: now },
		...(excludedVocaIds.length === 0 ? {} : { vocaId: { $nin: excludedVocaIds } })
	};
	const [reviewedDocuments, newDocuments] = await Promise.all([
		ReviewModel.aggregate([
			{
				$match: { ...commonFilter, $or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }] }
			},
			{ $set: { randomOrder: { $rand: {} } } },
			{ $sort: { dueAt: 1, randomOrder: 1 } },
			{ $limit: limit },
			{ $unset: 'randomOrder' }
		]),
		ReviewModel.aggregate([
			{ $match: { ...commonFilter, correctCount: 0, wrongCount: 0 } },
			{ $set: { randomOrder: { $rand: {} } } },
			{ $sort: { dueAt: 1, randomOrder: 1 } },
			{ $limit: limit },
			{ $unset: 'randomOrder' }
		])
	]);

	return {
		reviewed: reviewedDocuments.map(toPojo<ReviewEntity>),
		new: newDocuments.map(toPojo<ReviewEntity>)
	};
}

export async function findRecentDistinctAnsweredReviews(
	userId: string,
	limit: number
): Promise<LevelReview[]> {
	const documents = await ReviewModel.aggregate([
		{
			$match: {
				userId,
				$or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }]
			}
		},
		{ $sort: { lastReviewedAt: -1 } },
		{ $group: { _id: '$vocaId', review: { $first: '$$ROOT' } } },
		{ $sort: { 'review.lastReviewedAt': -1 } },
		{ $limit: limit },
		{ $replaceRoot: { newRoot: '$review' } },
		{
			$project: {
				_id: 0,
				vocaId: 1,
				reviewStage: 1,
				correctCount: 1,
				wrongCount: 1,
				lastReviewedAt: 1
			}
		}
	]);

	return documents.map(toPojo<LevelReview>);
}

export async function countDistinctAnsweredVocasByUser(
	userId: string,
	limit: number
): Promise<number> {
	const [result] = await ReviewModel.aggregate([
		{
			$match: {
				userId,
				$or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }]
			}
		},
		{ $group: { _id: '$vocaId' } },
		{ $limit: limit },
		{ $count: 'count' }
	]);

	return result?.count ?? 0;
}

export async function findReviewedVocaIdsByUserDirection(
	userId: string,
	directionField: 'promptLang' | 'answerLang',
	directionLang: LanguageCode
): Promise<string[]> {
	return ReviewModel.distinct('vocaId', {
		userId,
		[directionField]: directionLang
	});
}

export async function deleteReviewsByUserAndVoca(userId: string, vocaId: string): Promise<number> {
	const result = await ReviewModel.deleteMany({ userId, vocaId });
	return result.deletedCount ?? 0;
}

export async function deleteReviewsByVocaId(vocaId: string): Promise<number> {
	const result = await ReviewModel.deleteMany({ vocaId });
	return result.deletedCount ?? 0;
}

export async function getReviewSummary(
	userId: string,
	now: Date,
	longTermReviewStage: number,
	excludedVocaIds: string[]
): Promise<{
	totalReviewCount: number;
	todayStudiedCount: number;
	dueCount: number;
	queuedNewCount: number;
	learningCount: number;
	memorizedCount: number;
}> {
	const koreaOffsetMs = 9 * 60 * 60 * 1000;
	const dayMs = 24 * 60 * 60 * 1000;
	const todayStart = new Date(
		Math.floor((now.getTime() + koreaOffsetMs) / dayMs) * dayMs - koreaOffsetMs
	);
	const isAnswered = {
		$or: [{ $gt: ['$correctCount', 0] }, { $gt: ['$wrongCount', 0] }]
	};
	const isUnanswered = {
		$and: [{ $eq: ['$correctCount', 0] }, { $eq: ['$wrongCount', 0] }]
	};
	const isAvailable =
		excludedVocaIds.length === 0
			? { $literal: true }
			: { $not: [{ $in: ['$vocaId', excludedVocaIds] }] };
	const [summary] = await ReviewModel.aggregate([
		{ $match: { userId } },
		{
			$group: {
				_id: '$vocaId',
				answered: { $max: { $cond: [isAnswered, 1, 0] } },
				todayStudied: {
					$max: {
						$cond: [
							{
								$and: [
									isAnswered,
									{ $gte: ['$lastReviewedAt', todayStart] },
									{ $lte: ['$lastReviewedAt', now] }
								]
							},
							1,
							0
						]
					}
				},
				dueReview: {
					$max: { $cond: [{ $and: [isAnswered, { $lte: ['$dueAt', now] }, isAvailable] }, 1, 0] }
				},
				queuedNew: {
					$max: {
						$cond: [{ $and: [isUnanswered, { $lte: ['$dueAt', now] }, isAvailable] }, 1, 0]
					}
				},
				highestAnsweredStage: { $max: { $cond: [isAnswered, '$reviewStage', null] } }
			}
		},
		{
			$group: {
				_id: null,
				totalReviewCount: { $sum: '$answered' },
				todayStudiedCount: { $sum: '$todayStudied' },
				dueCount: { $sum: '$dueReview' },
				queuedNewCount: {
					$sum: {
						$cond: [{ $and: [{ $eq: ['$answered', 0] }, { $eq: ['$queuedNew', 1] }] }, 1, 0]
					}
				},
				learningCount: {
					$sum: {
						$cond: [
							{
								$and: [
									{ $eq: ['$answered', 1] },
									{ $lt: ['$highestAnsweredStage', longTermReviewStage] }
								]
							},
							1,
							0
						]
					}
				},
				memorizedCount: {
					$sum: {
						$cond: [
							{
								$and: [
									{ $eq: ['$answered', 1] },
									{ $gte: ['$highestAnsweredStage', longTermReviewStage] }
								]
							},
							1,
							0
						]
					}
				}
			}
		},
		{ $project: { _id: 0 } }
	]);

	return (
		summary ?? {
			totalReviewCount: 0,
			todayStudiedCount: 0,
			dueCount: 0,
			queuedNewCount: 0,
			learningCount: 0,
			memorizedCount: 0
		}
	);
}

export async function countAnsweredReviewsByVoca(
	vocaId: string,
	promptLang: LanguageCode,
	answerLang: LanguageCode
): Promise<number> {
	return ReviewModel.countDocuments({
		vocaId,
		promptLang,
		answerLang,
		$or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }]
	});
}

export async function findReviewByUserAndVoca(
	userId: string,
	vocaId: string,
	promptLang: ReviewEntity['promptLang'],
	answerLang: ReviewEntity['answerLang']
): Promise<ReviewEntity | null> {
	const document = await ReviewModel.findOne({
		userId,
		vocaId,
		promptLang,
		answerLang
	}).lean();

	return document == null ? null : toPojo(document);
}

export async function hasReviewByUserAndVoca(userId: string, vocaId: string): Promise<boolean> {
	return (await ReviewModel.exists({ userId, vocaId })) != null;
}

export async function countVocasFirstReviewedSince(
	userId: string,
	since: Date,
	limit: number
): Promise<number> {
	const [result] = await ReviewModel.aggregate([
		{ $match: { userId } },
		{ $group: { _id: '$vocaId', firstReviewedAt: { $min: '$createdAt' } } },
		{ $match: { firstReviewedAt: { $gte: since } } },
		{ $limit: limit },
		{ $count: 'count' }
	]);

	return result?.count ?? 0;
}

export async function getReviewByUserAndVoca(
	userId: string,
	vocaId: string,
	promptLang: ReviewEntity['promptLang'],
	answerLang: ReviewEntity['answerLang']
): Promise<ReviewEntity> {
	const currentReview = await findReviewByUserAndVoca(userId, vocaId, promptLang, answerLang);

	if (currentReview == null) {
		throw new Error(`Review not found: ${userId}/${vocaId}/${promptLang}/${answerLang}`);
	}

	return currentReview;
}

export async function createReview(reviewData: ReviewCreate): Promise<ReviewEntity> {
	const document = await ReviewModel.create(reviewData);
	return toPojo(document.toObject());
}

export async function saveReview(currentReview: ReviewEntity): Promise<ReviewEntity> {
	const { _id, createdAt: _createdAt, updatedAt: _updatedAt, ...reviewData } = currentReview;
	const document = await ReviewModel.findOneAndUpdate(
		{ _id },
		{ $set: toPojo(reviewData) },
		{ returnDocument: 'after' }
	).lean();

	if (document == null) {
		throw new Error(`Review not found: ${_id}`);
	}

	return toPojo(document);
}

export async function upsertReview(reviewData: ReviewCreate): Promise<ReviewEntity> {
	const document = await ReviewModel.findOneAndUpdate(
		{
			userId: reviewData.userId,
			vocaId: reviewData.vocaId,
			promptLang: reviewData.promptLang,
			answerLang: reviewData.answerLang
		},
		{ $set: reviewData },
		{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
	).lean();

	if (document == null) {
		throw new Error('Failed to upsert review.');
	}

	return toPojo(document);
}
