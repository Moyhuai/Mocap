// 配置下发 API:返回当前可用的动作清单与提示模板
// 注意:此处数据独立于前端 src/modules/config.ts,避免引入浏览器端依赖
import { Router } from 'express'

const router: Router = Router()

const actions = [
  { id: 'handRaise', name: '举手' },
  { id: 'squat', name: '深蹲' },
  { id: 'jump', name: '跳跃' },
  { id: 'bow', name: '鞠躬' },
  { id: 'wave', name: '挥手' },
  { id: 'turn', name: '转身' },
]

const promptTemplates = [
  { type: 'encourage', messages: ['做得很好,继续保持节奏!', '动作到位,继续保持!', '节奏稳定,继续保持!'] },
  { type: 'encourage', action: 'handRaise', messages: ['举手姿势标准!', '手臂伸展到位!'] },
  { type: 'encourage', action: 'squat', messages: ['深蹲深度合适,继续!', '膝盖轨迹漂亮!'] },
  { type: 'correct', messages: ['请保持身体居中', '注意呼吸节奏'] },
  { type: 'correct', action: 'squat', messages: ['膝盖稍微外展,与脚尖同向', '臀部再向后坐一点', '背部挺直,不要前倾'] },
  { type: 'correct', action: 'bow', messages: ['鞠躬角度可以再大一些', '颈部放松,目视脚前'] },
  { type: 'warn', messages: ['请确保全身在画面内', '光线不足,可能影响检测', '请站在距摄像头 1.5-2 米处'] },
  { type: 'complete', messages: ['动作完成,继续下一组!'] },
  { type: 'complete', action: 'squat', messages: ['深蹲完成 1 次', '深蹲完成 5 次,休息一下'] },
]

router.get('/', (_req, res) => {
  res.json({
    actions,
    promptTemplates,
    defaults: {
      sensitivity: 'medium',
      mirror: true,
      targetFps: 30,
    },
  })
})

export default router
