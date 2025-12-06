import { getPolymarketQuestion, saveAnswer } from "./api.js";

let currentQuestion = null;
let wallet = "TEST_USER"; // замени наphantom позже

const questionText = document.getElementById("question-text");
const imageEl = document.getElementById("question-image");
const yesBtn = document.getElementById("btn-yes");
const noBtn = document.getElementById("btn-no");
const resultEl = document.getElementById("result");
const scoreEl = document.getElementById("score");

async function loadQuestion() {
  resultEl.textContent = "";
  currentQuestion = await getPolymarketQuestion();

  if (!currentQuestion) {
    questionText.textContent = "Ошибка загрузки вопроса";
    imageEl.src = "";
    return;
  }

  questionText.textContent = currentQuestion.question;
  imageEl.src = currentQuestion.image || currentQuestion.icon || "";
}

yesBtn.onclick = () => handleAnswer("yes");
noBtn.onclick = () => handleAnswer("no");

async function handleAnswer(answer) {
  if (!currentQuestion) return;

  const correct =
    (currentQuestion.yesProb > currentQuestion.noProb ? "yes" : "no") === answer;

  resultEl.textContent = correct ? "✔ Верно!" : "✖ Неверно";

  // сохраняем результат
  await saveAnswer(wallet, correct);

  // обновляем счёт
  if (scoreEl && correct) {
    scoreEl.textContent = Number(scoreEl.textContent) + 1;
  }

  setTimeout(loadQuestion, 1500);
}

loadQuestion();
