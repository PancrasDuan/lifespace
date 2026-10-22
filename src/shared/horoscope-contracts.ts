import { z } from 'zod'

export const zodiacSigns = [
  { id: 'aries', name: '白羊座', icon: '♈\uFE0E' }, { id: 'taurus', name: '金牛座', icon: '♉\uFE0E' },
  { id: 'gemini', name: '双子座', icon: '♊\uFE0E' }, { id: 'cancer', name: '巨蟹座', icon: '♋\uFE0E' },
  { id: 'leo', name: '狮子座', icon: '♌\uFE0E' }, { id: 'virgo', name: '处女座', icon: '♍\uFE0E' },
  { id: 'libra', name: '天秤座', icon: '♎\uFE0E' }, { id: 'scorpio', name: '天蝎座', icon: '♏\uFE0E' },
  { id: 'sagittarius', name: '射手座', icon: '♐\uFE0E' }, { id: 'capricorn', name: '摩羯座', icon: '♑\uFE0E' },
  { id: 'aquarius', name: '水瓶座', icon: '♒\uFE0E' }, { id: 'pisces', name: '双鱼座', icon: '♓\uFE0E' },
] as const
export const signSchema = z.enum(zodiacSigns.map(sign => sign.id))
export type ZodiacSign = z.infer<typeof signSchema>
export const fortuneDimensions = [
  { id: 'all', name: '综合' }, { id: 'love', name: '爱情' }, { id: 'work', name: '事业学业' },
  { id: 'money', name: '财运' }, { id: 'health', name: '健康' },
] as const
const score = z.number().int().min(0).max(100).nullable()
const text = z.string().trim().min(1).max(12000).nullable()
export const horoscopeSchema = z.object({
  version: z.literal(1), source: z.literal('ALAPI'), sign: signSchema,
  dataDate: z.iso.date(), fetchedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
  scores: z.object({ all: score, love: score, work: score, money: score, health: score }),
  texts: z.object({ all: text, love: text, work: text, money: text, health: text }),
  lucky: z.object({ color: text, number: text, sign: text }),
  notice: text, yi: text, ji: text,
}).refine(value => Object.values(value.scores).some(item => item !== null) || Object.values(value.texts).some(item => item !== null), '运势内容为空')
export const horoscopeResultSchema = horoscopeSchema.safeExtend({ cacheHit: z.boolean(), warning: z.string().optional() })
export type Horoscope = z.infer<typeof horoscopeSchema>
export type HoroscopeResult = z.infer<typeof horoscopeResultSchema>

export function beijingDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function horoscopeDeadline(date: string): number { return Date.parse(`${date}T16:00:00.000Z`) }
export function isCurrentHoroscope(value: Horoscope, sign: ZodiacSign, now: number): boolean {
  const date = beijingDate(now)
  return value.sign === sign && value.dataDate === date && Date.parse(value.validUntil) === horoscopeDeadline(date)
    && Date.parse(value.fetchedAt) <= now && Date.parse(value.fetchedAt) < Date.parse(value.validUntil)
    && beijingDate(Date.parse(value.fetchedAt)) === date && now < Date.parse(value.validUntil)
}
