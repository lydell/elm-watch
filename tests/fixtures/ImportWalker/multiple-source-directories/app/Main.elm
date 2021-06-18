module Main exposing (main)

import Foot.International
import Foot.UsSurvey
import Hand.Thumb
  exposing
    (Thumb
    )
import Hand exposing (Hand)
import Hand.Palm -- Does not exist yet
import Foot.Heel
import Foot.Toe
import Html

length = Foot.International.meters + Foot.UsSurvey.meters

type alias Controller =
  { left : Thumb
  , right : Thumb
  , grip : Hand
  }

footDescription = "From " ++ Foot.Heel.english ++ " to " ++ Foot.Toe.english ++ "."

main =
  Html.div []
    [ Html.text footDescription
    , Html.text ("International foot: " ++ Debug.toString Foot.International.meters)
    , Html.text ("US Survey foot: " ++ Debug.toString Foot.UsSurvey.meters)
    ]
