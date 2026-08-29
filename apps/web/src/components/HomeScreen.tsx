type HomeScreenProps = {
  onStart: () => void;
};

export function HomeScreen({ onStart }: HomeScreenProps) {
  return (
    <section className="home-screen" id="main-view">
      <div className="home-logo">
        <span className="home-brand-mark"><i /><i /></span>
        <h1>EyeCan Room</h1>
        <p>눈동자 인식으로 방 안의 기기를 선택하고 제어합니다.</p>
        <button className="primary-button home-start-button" type="button" onClick={onStart}>시작하기</button>
      </div>
    </section>
  );
}
